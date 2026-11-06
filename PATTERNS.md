# Effect Design Patterns

### 7. A memoMap shared across runtimes

**Codebase.** Crosshatch

> Let React atoms and imperative code reuse the same built services.

**Description.** A `MemoMap` is how Effect deduplicates layer construction. By default each runtime has its own, so building `layerApp` for atoms and again for a `ManagedRuntime` would create two copies of every service. Sharing one memoMap means both see the same instances: one WebSocket and one key store.

**Example.** `internal-util/runtime.ts:1-6` and `app/runtime.ts:6-9`

```ts
export const memoMap = Layer.makeMemoMapUnsafe()
export const runtime = Atom.context({ memoMap })
```

```ts
const layerApp = layerPrelude.pipe(Boundary.layer("ui", import.meta.url))

export const atomRuntime = runtime(layerApp)
export const AppRuntime = ManagedRuntime.make(layerApp, { memoMap })
```

A related split is a long-lived prelude versus per-request services. `liminal/effect-workerd/Worker.ts:35-78` builds a `ManagedRuntime` from the prelude and provides request-scoped services (`ExecutionContext`, `HttpServerRequest`) per call with `Effect.provide`. It also forwards the runtime's memoMap through `Layer.CurrentMemoMap`, so per-request layers can reuse prelude services.

```ts
return handler.pipe(
  Effect.provide([
    Layer.succeed(ExecutionContext, ctx),
    Layer.succeed(HttpServerRequest.HttpServerRequest, HttpServerRequest.fromWeb(request)),
  ]),
  Effect.scoped,
  Effect.provideService(Layer.CurrentMemoMap, runtime.memoMap),
  runtime.runPromise,
)
```

> ⚠️ See [Gotchas](#gotchas-found-while-writing-this): `runtime` is currently declared inside `fetch`, so the prelude is rebuilt on every request.

**Takeaway.** If more than one runtime has to share the same service instances, give them one memoMap.

## Configuration-sharing

### 10. Config as a service

**Codebase.** Crosshatch

> One typed, redacted, composable definition of the environment, shared by the runtime and the deploy script.

**Description.** The environment is a `Context.Service` whose `make` is a `Config.all`, so it's lazy, schema-validated, and holds secrets as `Redacted`. App-level config extends a shared base with `Struct.assign`. The base prefers an existing service (`Effect.serviceOption(ChxStage)`) and falls back to reading `Config`, so the deploy stack can supply the stage directly while the runtime reads it from env vars. `Stage` is a template-literal schema.

**Example.** `internal-util/InternalEnv.ts:4-23`

```ts
export const InternalEnv = Effect.gen(function* () {
  const CHX_INTERNAL_STAGE = yield* Effect.serviceOption(ChxStage).pipe(
    Effect.map(Option.flatMap(S.decodeUnknownOption(Stage))),
    Effect.map(Option.match({
      onSome: Config.succeed,
      onNone: () => Config.schema(Stage, "CHX_INTERNAL_STAGE"),
    })),
  )
  return yield* Config.all({
    CHX_INTERNAL_STAGE,
    OTEL_EXPORTER_OTLP_HEADERS: Config.redacted("OTEL_EXPORTER_OTLP_HEADERS"),
    OTEL_METRICS_EXPORTER: CHX_INTERNAL_STAGE.pipe(Config.map((v) => (v.startsWith("dev_") ? "none" : "otlp"))),
    // ...
  })
})
```

`link/LinkEnv.ts:4-17`:

```ts
export class LinkEnv extends Context.Service<LinkEnv>()("@crosshatch-link/api/LinkEnv", {
  make: InternalEnv.pipe(
    Effect.map(Struct.assign({
      CDP_API_KEY_ID: Config.string("CDP_API_KEY_ID"),
      CDP_API_KEY_SECRET: Config.redacted("CDP_API_KEY_SECRET"),
      STRIPE_API_KEY: Config.redacted("STRIPE_API_KEY"),
    })),
  ),
}) {
  static readonly layer = Layer.effect(this, this.make)
}
```

**Takeaway.** Make the environment a service. You can then compose, override and test it, and the code that deploys the app and the code that runs it can't disagree about what's required.

### 22. Cross-request correlation with `Deferred`

**Codebase.** Crosshatch

> Pause one fiber until a different request arrives.

**Description.** A service keeps a map from ID to `Deferred`. One fiber registers an ID, notifies the client, and `await`s. Later, a different RPC (`SendPayment`) calls `resolve` with that ID. In this codebase the waiting fiber is in the middle of an LLM stream that needs a payment before it can call a tool. Swapping the in-memory layer for a durable one would not change any caller.

**Example.** `liminal/crosshatch/crosshatch/Invoices.ts:25-54`

```ts
export const layerMemory = Layer.effect(
  Invoices,
  Effect.sync(() => {
    const invoices: Record<PaymentId.PaymentId, {
      readonly accepts: ReadonlyArray<Requirements>
      readonly deferred: Deferred.Deferred<Payload.Payload>
    }> = {}
    return {
      add: Effect.fnUntraced(function* (accepts, id) {
        const deferred = yield* Deferred.make<Payload.Payload>()
        invoices[id] = { accepts, deferred }
      }),
      await: Effect.fnUntraced(function* (paymentId) {
        const { deferred } = yield* Effect.fromNullishOr(invoices[paymentId])
        return yield* Deferred.await(deferred)
      }),
      resolve: Effect.fnUntraced(function* (id, payload) {
        const { deferred, accepts } = yield* Effect.fromNullishOr(invoices[id])
        if (!Payload.isAcceptable(accepts, payload)) {
          delete invoices[id]
          return yield* new PayloadUnacceptableError({ accepts })
        }
        return yield* Deferred.succeed(deferred, payload)
      }),
    }
  }),
)
```

The waiting side, `lmnl.im/api/layerBridge.ts:18-29`:

```ts
propose: Effect.fnUntraced(
  function* ({ trace, required }) {
    const id = yield* PaymentId.FromMerchant.decodeRequired(required).pipe(Effect.map(Struct.get("id")))
    yield* invoices.add(required.accepts, id)
    const payloadFiber = yield* invoices.await(id).pipe(Effect.forkChild)
    yield* currentClient.send("PaymentRequired", { required, trace })
    const payload = yield* Fiber.join(payloadFiber)
    return { payload }
  },
  Effect.provideContext(actorContext),
  Effect.orDie,
),
```

Note that `layerBridge` captures `Effect.context<ContextActor>()` when the layer is built and re-provides it with `Effect.provideContext`. That pins the methods to the actor that created them.

**Takeaway.** Use a `Map<Id, Deferred>` service to turn a request/response that spans two calls into one sequential-looking effect.

## Hacking Ethereum RPC provider rate limiting

```ts
export class Balances extends Context.Service<Balances>()("@crosshatch/enclave/Balances", {
  make: Effect.gen(function* () {
    const balances = yield* SubscriptionRef.make(yield* Amount.from(0))
    const semaphore = yield* Semaphore.make(1)

    const invalidate = Effect.gen(function* () {
      // ...
      const balance = yield* Effect.promise(() => /* readContract via proxy() */).pipe(
        Effect.map(/* ... */),
        Effect.retry({ times: DEFAULT_PROXIES.base.length - 1 }),
      )
      return yield* SubscriptionRef.set(balances, balance)
    }).pipe(semaphore.withPermits(1))

    yield* Stream.runForEach(audition.state, /* update address, invalidate */).pipe(Effect.forkScoped)
    yield* Stream.make(void 0).pipe(
      Stream.concat(Stream.tick("20 seconds")),
      Stream.runForEach(() => invalidate),
      Effect.forkScoped,
    )
    return balances
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)
}
```

