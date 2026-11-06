# Effect Design Patterns

### 5. Config files that export Layers

**Codebase.** Traits

**What it is.** The user's `traits.ts` exports `Layer` values, not provider
names or options. The app imports the file at runtime, validates the Layers with
`S.declare`, and composes them with `Layer.unwrap`.

**Why it matters.** There's no provider registry, plugin system, or string-keyed
factory. Any `DecisionModel` or `LanguageModel` implementation works, and so do
any dependencies it needs (HTTP client, `Config.Redacted` secrets), because the
Layer is the extension point.

```ts
// traits.ts
const layerClient = OpenRouterClient.layerConfig({
  apiKey: Config.Redacted("OPENROUTER_API_KEY")
})

export default {
  decisionConcurrency: 16,
  excludes: ["repos/**"],
  layerDecisionModel: OpenRouterDecisionModel.layer({
    model: "~typesafe/jev-latest"
  }).pipe(Layer.provide(layerClient))
  // ...
} satisfies TraitsConfig
```

```ts
// traits/TraitsConfig.ts
layerDecisionModel: S.declare(
  (
    value
  ): value is Layer.Layer<DecisionModel.DecisionModel, any, NodeServices.NodeServices | HttpClient.HttpClient> =>
    Layer.isLayer(value)
),
// ...
export const layer = Effect.gen(function* () {
  const path = yield* Path.Path
  const { projectRoot } = yield* ProjectPaths
  const configRoot = projectRoot
  const url = yield* path.toFileUrl(path.join(configRoot, "traits.ts"))
  const module = yield* Effect.promise(() => import(url.href))
  const config = yield* pipe(module.default, S.decodeUnknownEffect(TraitsConfig))
  return Layer.mergeAll(
    config.layerDecisionModel.pipe(Layer.orDie),
    config.layerLanguageModel.pipe(Layer.orDie),
    Layer.effect(TraitsContext, /* ... */)
  )
}).pipe(Layer.unwrap)
```

**Codebase.** Traits

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

### 9. Working with context / intentional inheritance

**Codebase.** Traits

`Layer.build` inside an `Effect.fnUntraced` builds the HTTP server into the
current scope. The code can then read the port the OS assigned (`port: 0`) from
the resulting `Context`.

```ts
// traits/reflection/serve.ts
const server = HttpRouter.serve(routes, {
  disableLogger: true,
  disableListenLog: true
}).pipe(
  Layer.provideMerge(
    NodeHttpServer.layer(createServer, { host: "127.0.0.1", port: 0 })
  ),
  Layer.provide(
    Layer.succeed(HttpServerRequest.MaxBodySize, ByteSize.bytes(maxBodySize))
  )
)
const context = yield * Layer.build(server)
const address = Context.get(context, HttpServer.HttpServer).address
if (address._tag === "UnixPathAddress")
  return yield * Effect.die("Expected a TCP listener")
return `http://127.0.0.1:${address.port}`
```

**Where.** `traits/reflection/serve.ts:124-132`. The same file shows
`HttpApiBuilder.group(...).handleRaw(...)` and `Effect.callback` wrapping Node's
callback-based `gunzip`.

---

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

### 11. Layered `ConfigProvider`s / ensuring proper behavior within worktrees

**Codebase.** Traits

`ConfigProvider.layerAdd` adds a provider built from `.env` files, checking the
project root first and the Git root second. It's added _on top of_ environment
variables rather than replacing them.

```ts
// traits/TraitsConfigProvider.ts
export const layer = ConfigProvider.layerAdd(
  Effect.gen(function* () {
    // ...
    const files = Array.dedupe([
      path.join(projectRoot, ".env"),
      path.join(gitRoot, ".env")
    ])
    let provider = ConfigProvider.fromUnknown({})
    for (const file of files) {
      if (yield* fs.exists(file)) {
        provider = yield* ConfigProvider.fromDotEnv({ path: file }).pipe(
          Effect.map((value) => ConfigProvider.orElse(provider, value))
        )
      }
    }
    return provider
  }).pipe(Effect.withSpan("TraitsConfigProvider.load"))
)
```


## Tag that carries its own schema. Include the schema or not? Tree-shakability –– tag as a reference to a service that is conditionally consumed with serviceOption

**Description.** `Context.Service<Self, Shape>()(id)` returns a class-like tag. A library can wrap it and use `Object.assign` to attach static metadata, here the payload schema. A generic `layer(tag)` then reads the schema back from the tag to decode and verify a request. Users write one line per service and get a typed tag plus a generic layer constructor for it.

**Example.** `liminal/crosshatch/crosshatch/Crypto/SocketSignature.ts:25-38`

```ts
export interface Signature<Self, Id extends string, A extends S.Top> extends Context.Service<Self, Service<A>> {
  new (_: never): Context.ServiceClass.Shape<Id, Service<A>>
  readonly [TypeId]: typeof TypeId
  readonly payload: A
}

export const Service =
  <Self>() =>
  <Id extends string, A extends S.Top>(id: Id, payload: A): Signature<Self, Id, A> => {
    const tag = Context.Service<Self, Service<A>>()(id)
    return Object.assign(tag, { [TypeId]: TypeId, payload })
  }
```

The generic layer reads `signedPayload.payload` (`SocketSignature.ts:52-72`):

```ts
export const layer = <Self, Id extends string, A extends S.Top>(signedPayload: Signature<Self, Id, A>) =>
  Layer.effect(signedPayload, Effect.gen(function* () {
    // ...find + decode protocol token, verify Ed25519 signature...
    if (!verified) return yield* HttpApiError.Unauthorized.make()
    const payload = yield* S.decodeEffect(signedPayload.payload.pipe(S.toCodecJson, S.fromJsonString))(input)
    return { signer, payload, input, signature }
  }))
```

Usage: `crypto/ChxSignature.ts`

```ts
export class ChxSignature extends SocketSignature.Service<ChxSignature>()(
  "link.crosshatch.dev/ChxSignature",
  S.Struct({ host: S.String, box: S.Uint8ArrayFromBase64 }),
) {}
```

**Takeaway.** When every instance of a kind of service needs the same construction logic with different schemas or config, create the tag with a factory and attach the metadata to it.

### 19. Errors that render themselves

**Codebase.** Crosshatch

> Keep HTTP status codes out of handlers. The error knows how to become a response.

**Description.** `HttpServerRespondable.Respondable` lets any value, including a `Data.TaggedError`, define its own `HttpServerResponse`. Handlers just `yield* new PaymentRequired(...)`, and the server turns that into a 402 with encoded headers and the current span IDs. Setting `[ErrorReporter.ignore] = true` marks it as an expected failure, so it doesn't clutter error reporting.

**Example.** `liminal/crosshatch/crosshatch/ChxHttp.ts:26-71`

```ts
export class PaymentRequired
  extends Data.TaggedError("PaymentRequired")<{
    readonly required: Required
    readonly request: HttpServerRequest.HttpServerRequest
  }>
  implements HttpServerRespondable.Respondable
{
  [HttpServerRespondable.symbol]() {
    return Effect.gen({ self: this }, function* () {
      const traceInfo = yield* Effect.currentSpan.pipe(
        Effect.map(flow(
          Struct.pick(["traceId", "spanId"]),
          Struct.renameKeys({ traceId: CROSSHATCH_TRACE_ID, spanId: CROSSHATCH_SPAN_ID }),
        )),
        Effect.catchTags({ NoSuchElementError: () => Effect.undefined }),
      )
      const required = yield* S.encodeEffect(RequiredFromBase64JsonString)(this.required)
      return HttpServerResponse.empty({ status: 402, headers: { [PAYMENT_REQUIRED]: required, ...traceInfo } })
    })
  }

  override readonly [ErrorReporter.ignore] = true
}

export const require = Effect.fnUntraced(function* ({ required }: { readonly required: Required }) {
  const request = yield* HttpServerRequest.HttpServerRequest
  return yield* new PaymentRequired({ request, required })
})
```

**Takeaway.** For an expected failure with a fixed wire format, implement `Respondable` on the error and keep it in the typed error channel.


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

### 33. Atomic writes with scoped temp directories

**Codebase.** Traits

**What it is.** Writes go to a temp directory _inside_ the target directory (so
they're on the same file system), created with `makeTempDirectoryScoped`. The
file is then moved into place with `link` (for create-if-absent) or `rename`
(for replace). The `Scope` deletes the temp directory however the write ends.

**Why it matters.** Watchers and readers never see half-written files. `link`
fails if the file already exists, which gives an atomic existence check with no
race. The `.traits-write-` prefix doesn't end in `.md`, so the watcher ignores
it.

```ts
// traits/TraitStore.ts  (add)
yield *
  Effect.gen(function* () {
    const directory = yield* fs.makeTempDirectoryScoped({
      directory: traitsDirectory,
      prefix: ".traits-write-"
    })
    const temporary = path.join(directory, `${trait.name}.md`)
    yield* fs.writeFileString(temporary, Trait.serialize(trait))
    yield* fs.link(temporary, traitPath(trait.name)).pipe(
      Effect.catchTags({
        PlatformError: (error) =>
          error.reason._tag === "AlreadyExists"
            ? TraitAlreadyExistsError.make({ traitName: trait.name })
            : error
      })
    )
  }).pipe(Effect.scoped /* ... */)
```

**Where.** `traits/TraitStore.ts:274-290` (add), `:304-314` (update, preserving
file mode)


### 37. Variant Schema

**Codebase.** Traits

`VariantSchema` defines the fields once and extracts a schema for each variant.
`context` exists only in the `stored` variant. In the Markdown file it's the
body, not part of the frontmatter.

```ts
// traits/Trait.ts
const variants = VariantSchema.make({
  variants: ["stored", "frontmatter"],
  defaultVariant: "stored"
})

const fields = variants.Struct({
  name: TraitName,
  subject: S.String.check(S.isPattern(/\S/)).annotate({/* ... */}),
  // ...
  context: S.String.pipe(S.optional)
    .annotate({/* ... */})
    .pipe(variants.FieldOnly(["stored"]))
})

export const Trait = variants.extract(fields, "stored")
export const TraitFrontmatter = variants.extract(fields, "frontmatter")
```

**Where.** `traits/Trait.ts:16-48`. `TraitName` (`:9-14`) is also a nice example
of branding with `check`, a pattern, and `annotate` for LLM-facing descriptions.

### 38. Type-level helpers on Effect's type utilities

**Codebase.** Crosshatch

> Keep literal types precise through generic transformations.
