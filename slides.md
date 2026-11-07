---
title: Advanced Effect Design Patterns
theme: default
colorSchema: auto
layout: cover
eyebrow: "Effect Miami #3"
byline: By Harry Solovay
role: CEO of Crosshatch Labs Inc.
fonts:
  sans: Libre Baskerville
  serif: Libre Baskerville
  mono: JetBrains Mono
  weights: "400,700"
  italic: true
transition: fade
mdc: true
---

# Advanced Effect Design Patterns

Taming complexity through composition

---
layout: chapter
chapter: I
accent: blue
---

# Service factories

A function that returns a class you can extend, then yield like any other service.

---

# You've seen this shape

<p class="eyebrow">A call that returns a class</p>

````md magic-move
```ts
class Clock extends Context.Service<Clock, {
  readonly now: Effect.Effect<number>
}>()("app/Clock") {}

export const layer = Layer.succeed(Clock, {
  now: Effect.sync(() => Date.now()),
})
```
```ts
class Clock extends Context.Service<Clock>()("app/Clock", {
  make: Effect.succeed({
    now: Effect.sync(() => Date.now()),
  }),
}) {
  static readonly layer = this.make.pipe(Layer.effect(this))
}
```
````

<v-click>

`Context.Service<Self>()(id, …)` is a call that returns a class built from your arguments. Nothing stops *us* from writing functions with the same shape.

</v-click>

<!--
This is a call that returns a class (S.TaggedError and S.Class work the same way).
Self goes first in its own call because TypeScript can't infer some type arguments
while you write others explicitly.

Second overload: pass `make` and the shape is inferred from it. The class gets a
static `make`, and the layer can live on the class too.
-->

---

# One topic per event

```ts
class OrderPlaced
  extends Context.Service<OrderPlaced, PubSub.PubSub<Order>>()("app/OrderPlaced") {}
const OrderPlacedLive = Layer.effect(OrderPlaced, PubSub.unbounded<Order>())

class OrderShipped
  extends Context.Service<OrderShipped, PubSub.PubSub<Shipment>>()("app/OrderShipped") {}
const OrderShippedLive = Layer.effect(OrderShipped, PubSub.unbounded<Shipment>())

class UserSignedUp
  extends Context.Service<UserSignedUp, PubSub.PubSub<User>>()("app/UserSignedUp") {}
const UserSignedUpLive = Layer.effect(UserSignedUp, PubSub.unbounded<User>())

class PaymentFailed
  extends Context.Service<PaymentFailed, PubSub.PubSub<PaymentFailure>>()("app/PaymentFailed") {}
const PaymentFailedLive = Layer.effect(PaymentFailed, PubSub.unbounded<PaymentFailure>())

// … and again for every event
```

<v-click>

Copied per event, schema kept elsewhere, every layer wired by hand.

</v-click>

---

# The factory

<CodeFile path="Topic.ts" label="Implementation">

```ts {all|2|3|4|5|6}
export const Service =
  <Self>() =>
  <Id extends string, Item extends S.Top>(id: Id, schema: Item) => {
    const tag = Context.Service<Self, PubSub.PubSub<Item["Type"]>>()(id)
    const layer = Layer.effect(tag, PubSub.unbounded<Item["Type"]>())
    return Object.assign(tag, { schema, layer })
  }
```

</CodeFile>

<!--
1. Self is explicit, in its own call, same as Context.Service.
2. The id and schema are inferred. Item extends S.Top accepts any schema (S.Any would
   mean the schema for `any`), and Item["Type"] fixes what the channel carries.
3. The real tag is a plain Context.Service. We aren't reimplementing anything.
4. Build the layer once, here, instead of next to every event.
5. Object.assign puts schema and layer on the class itself, and keeps the tag's
   constructor type, so `extends` still works.
-->

---

# Declaring the family

<p class="eyebrow">Orders.ts</p>

```ts
export class OrderPlaced
  extends Topic.Service<OrderPlaced>()("app/OrderPlaced", Order) {}
export class OrderShipped
  extends Topic.Service<OrderShipped>()("app/OrderShipped", Shipment) {}
export class UserSignedUp
  extends Topic.Service<UserSignedUp>()("app/UserSignedUp", User) {}
export class PaymentFailed
  extends Topic.Service<PaymentFailed>()("app/PaymentFailed", PaymentFailure) {}
```

<v-clicks>

- One declaration per event
- The schema is declared right next to the event
- `OrderPlaced.layer` and `OrderPlaced.schema` come with the class

</v-clicks>

---

# Yield it like any service

```ts {1-4|5|8}
const program = Effect.gen(function* () {
  const topic = yield* OrderPlaced   // PubSub<Order>
  yield* PubSub.publish(topic, order)
}).pipe(
  Effect.provide(OrderPlaced.layer), // the layer comes with the class
)

OrderPlaced.schema                   // so does the schema, typed exactly
```

<!--
Consumers never learn there was a factory. It's a tag, so yield*, Layer and
Effect.provide all just work.
-->

---

# Going public

<p class="eyebrow">An explicit interface for a library API</p>

```ts {all|3|4-5}
export interface Topic<Self, Id extends string, Item extends S.Top>
  extends Context.Service<Self, PubSub.PubSub<Item["Type"]>> {
  new (_: never): Context.ServiceClass.Shape<Id, PubSub.PubSub<Item["Type"]>>
  readonly schema: Item
  readonly layer: Layer.Layer<Self>
}
```

<v-click>

Annotate the factory's return type with it, and the type shows up by name in hovers and docs.

</v-click>

<!--
Optional for app code; inference already handles it. Worth it once the factory is
exported from a library. crosshatch's Extension.Service is this same pattern at
production scale.
-->

---

# Annotating the factory

<CodeFile path="Topic.ts" label="Implementation">

````md magic-move
```ts
export const Service =
  <Self>() =>
  <Id extends string, Item extends S.Top>(id: Id, schema: Item) => {
    const tag = Context.Service<Self, PubSub.PubSub<Item["Type"]>>()(id)
    const layer = Layer.effect(tag, PubSub.unbounded<Item["Type"]>())
    return Object.assign(tag, { schema, layer })
  }
```
```ts {3}
export const Service =
  <Self>() =>
  <Id extends string, Item extends S.Top>(id: Id, schema: Item): Topic<Self, Id, Item> => {
    const tag = Context.Service<Self, PubSub.PubSub<Item["Type"]>>()(id)
    const layer = Layer.effect(tag, PubSub.unbounded<Item["Type"]>())
    return Object.assign(tag, { schema, layer })
  }
```
````

</CodeFile>

<v-click at="1">

The body doesn't change. `Object.assign` already produces something assignable to `Topic`, so the annotation only names the type the factory was already returning.

</v-click>

<!--
Click once to animate the return type in. Point out that nothing else moves: the
annotation is a check plus a name, not new behaviour. If the body ever drifts from
the interface, the error shows up here instead of at every call site.
-->

---

# Takeaway

> Wrap `Context.Service` in a curried factory, and attach what every member of the family shares.

<p class="drop-cap">Each member is declared in one line, yielded as an ordinary service, and carries its own schema and layer. The repetition lives in one function instead of every file.</p>

---
layout: chapter
chapter: II
accent: gold
---

# The Layer is the plugin

No provider registry, no plugin system. The user hands the library a Layer.

---

# The usual approach

<p class="eyebrow">A string-keyed provider registry</p>

```ts
// config.json
{ "provider": "openrouter", "model": "~typesafe/jev-latest" }
```

```ts
// library
const providers = {
  openrouter: (options) => makeOpenRouter(options),
  anthropic: (options) => makeAnthropic(options),
  openai: (options) => makeOpenAI(options),
}
```

<v-clicks>

- Every provider has to be known to the library
- A new provider means a new library release
- Provider-specific configuration must be maintained and carefully migrated between versions
- Secrets and HTTP clients get handled case by case

</v-clicks>

<!--
This is the shape most AI-enabled tools ship: a name in config, a lookup table
in the library. The library ends up owning every integration.
-->

---

# Export a Layer instead

<CodeFile path="traits.ts" label="User config">

```ts {all|1-3|6-8}
const layerClient = OpenRouterClient.layerConfig({
  apiKey: Config.Redacted("OPENROUTER_API_KEY"),
})

export default {
  layerLanguageModel: OpenRouterLanguageModel.layer({
    model: "anthropic/claude-sonnet-5.5",
  }).pipe(Layer.provide(layerClient)),
} satisfies TraitsConfig
```

</CodeFile>

<v-click>

The config file is ordinary TypeScript. The user picks the implementation, and wires up its dependencies and secrets themselves.

</v-click>

<!--
1. The HTTP client and the API key are the user's business. Config.Redacted keeps
   the key out of logs.
2. The value is a Layer that produces Effect's own LanguageModel service. The
   library never sees the word "OpenRouter".
-->

---

# The library side

<CodeFile path="TraitsConfig.ts" label="Implementation">

```ts {all|1|3-6|10|11|12}
export type TraitsConfig = typeof TraitsConfig.Type
export const TraitsConfig = S.Struct({
  layerLanguageModel: S.declare(
    (u): u is Layer.Layer<LanguageModel.LanguageModel, unknown, HttpClient.HttpClient> =>
      Layer.isLayer(u),
  ),
})

export const layer = Effect.gen(function* () {
  const module = yield* Effect.promise(() => import(configUrl))
  const config = yield* S.decodeUnknownEffect(TraitsConfig)(module.default)
  return config.layerLanguageModel.pipe(Layer.orDie)
}).pipe(Layer.unwrap)
```

</CodeFile>

<!--
1. S.declare makes "a Layer that provides LanguageModel" a schema, so the config
   is validated like any other input.
2. Import the user's file at runtime.
3. Decode it. A bad config fails with a SchemaError, not a crash later on.
4. Return the user's Layer, and Layer.unwrap turns the whole effect into a Layer.
-->

---

# Any implementation works

<p class="eyebrow">Library code only ever sees the service</p>

```ts {1-6|7}
const review = Effect.gen(function* () {
  const response = yield* LanguageModel.generateText({
    prompt: "Does this diff follow the trait?",
  })
  return response.text
}).pipe(
  Effect.provide(TraitsConfig.layer),
)
```

<v-click>

A different provider or an internal gateway is just a different Layer in the user's config. Neither needs a change to the library.

</v-click>

<!--
1. Library code asks for LanguageModel and nothing else. No provider names anywhere.
2. TraitsConfig.layer is whatever the user exported. After providing it, the only
   requirement left is HttpClient, which the app supplies.
-->


---

# Takeaway

> Let users configure your library by handing it a Layer.

<p class="drop-cap">The Layer is the extension point. Any implementation of the service works, along with whatever it depends on, and <code>S.declare</code> keeps the boundary validated and typed like any other input.</p>

---
layout: chapter
chapter: III
accent: green
---

# Branching conversations

Fork a chat's history the way you'd fork a fiber.

---

# Chat is a service

<p class="eyebrow">Its history lives in a Ref</p>

<div class="chat-grid">

```ts {all|2|3|4|5}
const program = Effect.gen(function* () {
  const chat = yield* Chat.Chat
  yield* chat.generateText({ prompt: "Let's review some code." })
  yield* chat.generateText({ prompt: "Here's the first file: …" })
}).pipe(Effect.provideServiceEffect(Chat.Chat, Chat.empty))
```

<figure class="history">
  <figcaption>chat.history</figcaption>
  <ol>
    <li v-click="2" class="user"><span>user</span>Let's review some code.</li>
    <li v-click="2" class="assistant"><span>assistant</span>Sure, send it over.</li>
    <li v-click="3" class="user"><span>user</span>Here's the first file: …</li>
    <li v-click="3" class="assistant"><span>assistant</span>Line 12 leaks a handle…</li>
  </ol>
</figure>

</div>

<v-click>

Every `generateText` appends to the same history. So what happens when three experts should review the code *in parallel*, each picking up from this point?

</v-click>

<!--
Chat.Chat is an ordinary service. Its history is a Ref<Prompt>, and each call reads
from and appends to it. Sharing one chat across concurrent fibers would mix all the
experts into one conversation.
-->

---

# Sharing one chat

<p class="eyebrow">Three experts, one history</p>

<div class="chat-grid">
<div>

```ts {all|7-10|3|4}
const review = Effect.fn(function* (expert: string) {
  const chat = yield* Chat.Chat
  yield* chat.generateText({ prompt: `You're the ${expert} expert.` })
  yield* chat.generateText({ prompt: "What do you think?" })
})

yield* Effect.all(
  ["security", "performance", "design"].map(review),
  { concurrency: "unbounded" },
)
```

<v-click at="4">

Each call is atomic, but turns from different fibers interleave. By the time anyone asks *"What do you think?"*, the model has been told it's all three experts.

</v-click>

</div>

<figure class="history compact">
  <figcaption>chat.history</figcaption>
  <ol>
    <li class="user earlier"><i class="dot"></i>Let's review some code.</li>
    <li class="assistant earlier"><i class="dot"></i>…</li>
    <li v-click="2" class="user"><i class="dot coral"></i>You're the security expert.</li>
    <li v-click="2" class="assistant"><i class="dot coral"></i>…</li>
    <li v-click="2" class="user"><i class="dot green"></i>You're the performance expert.</li>
    <li v-click="2" class="assistant"><i class="dot green"></i>…</li>
    <li v-click="2" class="user"><i class="dot plum"></i>You're the design expert.</li>
    <li v-click="2" class="assistant"><i class="dot plum"></i>…</li>
    <li v-click="3" class="user"><i class="dot coral"></i>What do you think?</li>
    <li v-click="3" class="assistant"><i class="dot coral"></i>…</li>
    <li v-click="3" class="user"><i class="dot green"></i>What do you think?</li>
    <li v-click="3" class="assistant"><i class="dot green"></i>…</li>
    <li v-click="3" class="user"><i class="dot plum"></i>What do you think?</li>
    <li v-click="3" class="assistant"><i class="dot plum"></i>…</li>
  </ol>
</figure>

</div>

<!--
Chat serializes calls with a one-permit semaphore, so no single turn gets torn. But
the lock is per call, not per expert. This is the real order with Effect 4.1.2: all
three role prompts land first, then all three questions, and every question sees
every role. The experts need their own copy of the history.
-->

---

# Branch

<CodeFile path="branch.ts" label="Implementation">

```ts {all|1-2|4|5|6|10}
export const branch = Effect.provideServiceEffect(
  Chat.Chat,
  Effect.gen(function* () {
    const chat = yield* Chat.Chat
    const history = yield* Ref.get(chat.history)
    return yield* Chat.fromPrompt(history)
  }),
)

branch satisfies <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, Chat.Chat | R>
```

</CodeFile>

<!--
1. provideServiceEffect, data-last: branch is a function from an effect to an effect,
   with Chat.Chat replaced for that effect only.
2. Read the Chat that's currently in context, the outer one.
3. Snapshot its history.
4. Build a brand new Chat seeded with that snapshot. Writes go to the copy.
5. The signature: any effect in, the same effect out, still requiring a Chat. The
   branch needs an outer chat to copy from. (Exact inferred type:
   Chat.Chat | Exclude<R, Chat.Chat>, the same set.)
-->

---

# Branch each expert

````md magic-move
```ts
const program = Effect.gen(function* () {
  const chat = yield* Chat.Chat
  yield* chat.generateText({ prompt: "Let's review some code." })
  yield* Effect.all(
    ["security", "performance", "design"].map(review),
    { concurrency: "unbounded" },
  )
}).pipe(
  Effect.provideServiceEffect(Chat.Chat, Chat.empty),
  Effect.provide(TraitsConfig.layer),
)
```
```ts {5}
const program = Effect.gen(function* () {
  const chat = yield* Chat.Chat
  yield* chat.generateText({ prompt: "Let's review some code." })
  yield* Effect.all(
    ["security", "performance", "design"].map((expert) => review(expert).pipe(branch)),
    { concurrency: "unbounded" },
  )
}).pipe(
  Effect.provideServiceEffect(Chat.Chat, Chat.empty),
  Effect.provide(TraitsConfig.layer),
)
```
```ts {5}
const program = Effect.gen(function* () {
  const chat = yield* Chat.Chat
  yield* chat.generateText({ prompt: "Let's review some code." })
  yield* Effect.all(
    ["security", "performance", "design"].map(flow(review, branch)),
    { concurrency: "unbounded" },
  )
}).pipe(
  Effect.provideServiceEffect(Chat.Chat, Chat.empty),
  Effect.provide(TraitsConfig.layer),
)
```
````

<v-click at="1">

One `.pipe(branch)` per expert. Each sees the opening exchange plus only its own turns, and the outer chat keeps just the opening exchange. `review` itself doesn't change: it still just asks for `Chat.Chat`.

</v-click>

<!--
Same review function as "Sharing one chat". Checked on Effect 4.1.2 with a stub
model: each expert's question saw 5 messages (the 2 shared, its role turn, its
question), and the outer chat stayed at 2.
Provide an empty Chat to start, and the LanguageModel from Chapter II's TraitsConfig.layer.
Last step: branch is just a function from effect to effect, so it composes with flow.
-->

---

# Takeaway

> Because the chat is a service, branching a conversation is just providing a different one.

<p class="drop-cap">Since <code>Effect.provideServiceEffect</code> scopes the replacement to a single effect, code that uses the chat never knows. Concurrency and history isolation come from the Effect primitives you already know.</p>

---
layout: chapter
chapter: IV
accent: coral
---

# Carrying context

When an effect is stored and run somewhere else, decide what context it takes along.

---

# Context flows through yield*

```ts {1-4|6-8}
const saveOrder = Effect.fn(function* (payload: string) {
  const db = yield* Database
  yield* db.insert(payload)
})

const program = Effect.gen(function* () {
  yield* saveOrder("o_1") // runs with the caller's context
}).pipe(Effect.provide(Database.layer))
```

<v-click>

Usually we never think about this. A child effect inherits whatever its caller has, and any gaps show up in `R`.

</v-click>

---

# Stored, not yielded

```ts {1-5|7-8|10-13}
class Hooks extends Context.Reference<
  Map<string, (payload: string) => Effect.Effect<void>>
>("app/Hooks", {
  defaultValue: () => new Map(),
}) {}

const hooks = yield* Hooks
hooks.set("order.placed", saveOrder) // ✗ Effect<void, never, Database> is not Effect<void>

const dispatch = Effect.fn(function* (event: string, payload: string) {
  const hook = (yield* Hooks).get(event)
  if (hook) yield* hook(payload)
})
```

<v-click>

The hook is registered at one point in the lifecycle and run at another, by code with a different context.

</v-click>

---

# Capture the context

<CodeFile path="Hooks.ts" label="Implementation">

```ts {all|2|3}
const hooks = yield* Hooks
const context = yield* Effect.context<R>()
hooks.set(name, flow(f, Effect.provideContext(context)))
```

</CodeFile>

<!--
1. While the layer is being built, grab the context the hook will need.
2. Store a version of the hook that brings its own context along.
This runs inside layerHook, a layer that registers the hook while it's built. The
hook's requirements become the layer's requirements, so the type system still makes
sure Database is provided:
  layerHook("order.placed", saveOrder).pipe(Layer.provide(Database.layer))
-->

---

# What gets captured

```ts {1-2|4-5|6}
const context = yield* Effect.context<Database>()
// propagates `Database` requirement to outer effect

const onlyDb = Context.pick(Database)(context)       // holds just Database
const noScope = Context.omit(Scope.Scope)(context)   // everything but the Scope
saveOrder("o_1").pipe(Effect.provideContext(onlyDb)) // Effect<void>: Database is provided
```

<v-clicks>

- `Effect.context<R>()` is typed by `R`, but at runtime it captures the whole context
- `provideContext` merges: the runner's services stay visible, and captured ones win
- `Context.pick` and `Context.omit` choose what the stored effect inherits

</v-clicks>

<!--
Verified on Effect 4.1.2: a service provided around the capture but not named in R
still showed up inside the stored effect. With Context.pick it didn't.
-->

---

# The Scope trap

````md magic-move
```ts {all|1-4|6-7}
const auditOrder = Effect.fn(function* (payload: string) {
  yield* Effect.acquireRelease(open(payload), () => close(payload))
  yield* saveOrder(payload)
})

const context = yield* Effect.context<Database>()
hooks.set("order.placed", flow(auditOrder, Effect.provideContext(context), Effect.scoped))
```
```ts {7}
const auditOrder = Effect.fn(function* (payload: string) {
  yield* Effect.acquireRelease(open(payload), () => close(payload))
  yield* saveOrder(payload)
})

const context = yield* Effect.context<Database>()
hooks.set("order.placed", flow(auditOrder, Effect.scoped, Effect.provideContext(context)))
```
````

<v-click at="2">

`Effect.context()` captured the layer's `Scope` along with `Database`. With `provideContext` inside `Effect.scoped`, the captured `Scope` shadows the fresh one, so whatever a hook acquires stays open until the app shuts down.

</v-click>

<v-click at="3">

Swap them. The innermost provide wins, so the fresh `Scope` sits closest to `auditOrder` and each call releases what it acquired.

</v-click>

<!--
1. A hook that acquires a resource per call and should release it when the call ends.
2. Registered while the layer is being built, with its context captured, and scoped
   so each call gets its own Scope. Or so it looks: on Effect 4.1.2, close only runs
   when the app's layers are torn down.
3. Swap the order. Now each dispatch logs open, insert, close. Both orderings
   type-check, which is what makes this easy to miss. Verified by running both.
-->

---

# Takeaway

> When an effect runs outside the fiber that defined it, capture its context explicitly, and choose what goes with it.

<p class="drop-cap">Grab the context with <code>Effect.context</code> where the effect is defined, and re-provide it where it runs. Since it captures all of the fiber's services, decide what to leave behind with <code>Context.pick</code> or <code>Context.omit</code>, or by ordering, and keep the <code>Scope</code> local to each run.</p>

---
layout: chapter
chapter: V
accent: plum
---

# Errors that render themselves

Let a domain error decide how it becomes an HTTP response.

---

# Status codes in handlers

<p class="eyebrow">Mapping errors by hand</p>

```ts {all|1-5|6-9}
const getUser = Effect.gen(function* () {
  const { id } = yield* HttpRouter.schemaPathParams(S.Struct({ id: S.String }))
  const user = yield* findUser(id)
  return yield* HttpServerResponse.json(user)
}).pipe(
  Effect.catchTag("UserNotFound", (e) =>
    HttpServerResponse.json({ error: "UserNotFound", id: e.id }, { status: 404 })),
)
```

<v-clicks>

- Forget one, and a domain error turns into a 500

</v-clicks>

---

# The error knows its response

<CodeFile path="UserNotFound.ts" label="Implementation">

```ts {all|2|4-6|8}
export class UserNotFound extends Data.TaggedError("UserNotFound")<{ readonly id: string }>
  implements HttpServerRespondable.Respondable
{
  [HttpServerRespondable.symbol]() {
    return HttpServerResponse.json({ error: "UserNotFound", id: this.id }, { status: 404 })
  }

  readonly [ErrorReporter.ignore] = true
}
```

</CodeFile>

<!--
1. Respondable is a protocol: any value with this method can become a response.
2. The error defines its own status and body, once.
3. ErrorReporter.ignore marks it as an expected failure, more on that in a moment.
-->

---

# Handlers just fail

```ts {3}
const getUser = Effect.gen(function* () {
  const { id } = yield* HttpRouter.schemaPathParams(S.Struct({ id: S.String }))
  const user = yield* findUser(id) // may fail with UserNotFound
  return yield* HttpServerResponse.json(user)
})
```

<v-click>

No `catchTag`, no status code. The error stays in the typed error channel, and the server asks it for a response.

</v-click>

---

# What the server sends

```txt
GET /users/1   200   {"id":"1","name":"Ada"}
GET /users/2   404   {"error":"UserNotFound","id":"2"}   not reported
GET /plain     500   (an error with no Respondable)      reported
```

<v-clicks>

- A respondable error becomes exactly the response it describes
- Anything else still falls back to a 500
- `ErrorReporter.ignore` keeps the expected 404 out of every reporter, without changing its response

</v-clicks>

<!--
Real output: these routes served through HttpRouter.toWebHandler and called with
Request objects, on Effect 4.1.2, with an ErrorReporter installed at the app level.
A 404 is a normal outcome, not an incident. A respondable error *without* ignore
(e.g. a 403) is still reported. Reporters built with ErrorReporter.make skip anything
marked ignore, which also keeps it out of OTel.
-->

---

# Standard bodies

<CodeFile path="Forbidden.ts" label="Problem Details">

```ts {all|5-10}
export class Forbidden extends Data.TaggedError("Forbidden")<{ readonly reason: string }>
  implements HttpServerRespondable.Respondable
{
  [HttpServerRespondable.symbol]() {
    return Effect.succeed(ProblemDetails.toResponse({
      type: "https://example.com/problems/forbidden",
      status: 403,
      title: "Forbidden",
      detail: this.reason,
    }))
  }
}
```

</CodeFile>

<v-click>

`effect/http` ships RFC 9457 Problem Details, so errors can share one `application/problem+json` shape.

</v-click>

---

# With HttpApi

<p class="eyebrow">The status lives on the schema</p>

```ts {1-3|5-9|11-12}
export class UserNotFound extends S.TaggedError<UserNotFound>()("UserNotFound", {
  id: S.String,
}, { httpApiStatus: 404 }) {}

HttpApiEndpoint.get("getUser", "/users/:id", {
  params: { id: S.String },
  success: User,
  error: UserNotFound,
})

// OpenAPI responses:   200, 404
// GET /users/2   →     404 {"_tag":"UserNotFound","id":"2"}
```

<v-click>

When the API is declared with HttpApi, the error's status is part of its schema, so it shows up in the generated OpenAPI spec and in typed clients too.

</v-click>

<!--
Verified on Effect 4.1.2: OpenApi.fromApi lists 200 and 404 for this endpoint, and the
handler failing with UserNotFound returns a real 404.
-->

---

# Takeaway

> Give each expected failure its own response, and let handlers simply fail.

<p class="drop-cap">Implement <code>Respondable</code> on the error, or annotate its schema with a status when using HttpApi. Mark expected failures with <code>ErrorReporter.ignore</code>, and keep them in the typed error channel all the way to the wire.</p>

---
layout: chapter
chapter: VI
accent: blue
---

# Atomic writes

Make a file appear all at once, or not at all.

---

# The obvious version

```ts {all|5|6}
const create = Effect.fn(function* (directory: string, name: string, contents: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const target = path.join(directory, name)
  if (yield* fs.exists(target)) return yield* new FileAlreadyExists({ name })
  yield* fs.writeFileString(target, contents)
})
```

<v-clicks>

- Check, then write: two concurrent creates can both pass the check
- Readers and file watchers can see the file half-written
- A crash partway through leaves a truncated file behind

</v-clicks>

<!--
Ran 10 of these concurrently against the same name: all 10 reported success, and the
file held whichever writer happened to finish last (7, 8, 9 across three runs).
-->

---

# Stage, then link

<CodeFile path="create.ts" label="Create if absent">

```ts {all|5|6-7|9-11|12}
export const create = Effect.fn(function* (directory: string, name: string, contents: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path

  const staging = yield* fs.makeTempDirectoryScoped({ directory, prefix: ".write-" })
  const staged = path.join(staging, name)
  yield* fs.writeFileString(staged, contents)

  yield* fs.link(staged, path.join(directory, name)).pipe(
    Effect.catchReason("PlatformError", "AlreadyExists", () => new FileAlreadyExists({ name })),
  )
}, Effect.scoped)
```

</CodeFile>

<v-click>

`makeTempDirectoryScoped` ties the staging directory to the `Scope`, so it's deleted however the write ends: success, failure, or interruption.

</v-click>

<!--
1. A private staging directory, created next to the target.
2. Write the whole file there, where nobody is looking.
3. link publishes it in one step, and fails if the name is already taken. That failure
   is the existence check, so there's no gap between checking and writing.
   catchReason picks the AlreadyExists reason out of PlatformError.
4. Effect.scoped closes the scope when the write ends, which deletes the staging
   directory along with the staged copy.

Checked against a real directory on Effect 4.1.2 with NodeServices: new file, existing
file, failure before link, and interruption mid-write all leave the staging directory
removed.

Why stage next to the target: link and rename only work within one file system, so
staging in /tmp can fail. A directory beside the target is guaranteed to be on the same
one, and the .write- prefix keeps it out of watchers looking for *.md.
-->

---

# Replacing a file

<CodeFile path="replace.ts" label="Replace">

```ts {all|10-11|12}
export const replace = Effect.fn(function* (directory: string, name: string, contents: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const target = path.join(directory, name)

  const staging = yield* fs.makeTempDirectoryScoped({ directory, prefix: ".write-" })
  const staged = path.join(staging, name)
  yield* fs.writeFileString(staged, contents)

  const { mode } = yield* fs.stat(target)
  yield* fs.chmod(staged, mode)
  yield* fs.rename(staged, target)
}, Effect.scoped)
```

</CodeFile>

<v-click>

`rename` swaps the file in one step, so readers see the old contents or the new ones, never a mix. Copying the mode first keeps permissions from silently changing.

</v-click>

---

# Takeaway

> Write somewhere private, then publish with one atomic file-system call.

<p class="drop-cap">Stage beside the target with <code>makeTempDirectoryScoped</code>, publish with <code>link</code> to create or <code>rename</code> to replace, and let the <code>Scope</code> clean up however the write ends.</p>

---
layout: chapter
chapter: VII
accent: green
---

# Variant schemas

Define the fields once, and extract a schema for each place they're used.

---

# Heads up: it's unstable

<p class="eyebrow">effect/schema/VariantSchema</p>

```ts
/**
 * @stability unstable
 */
export declare const make: …
```

Every export of `VariantSchema` is marked `@stability unstable`. The API may still change.

<v-click>

<p class="drop-cap">Even so, it’s so awesome that it’s worth reaching for anyway. Pin your Effect version, and enjoy.</p>

</v-click>

<!--
Checked in Effect 4.1.2: all 26 stability tags in VariantSchema.d.ts and all 57 in
Model.d.ts say unstable.
-->

---

# One record, three shapes

<p class="eyebrow">A user, as stored, created and returned</p>

```txt
           id    email    passwordHash    createdAt
select     ✓     ✓        ✓               ✓
insert           ✓        ✓
json       ✓     ✓                        ✓
```

<v-clicks>

- The database generates `id` and `createdAt`, so an insert never includes them
- `passwordHash` is stored, but never sent to clients
- Three schemas that have to agree on every other field

</v-clicks>

---

# Define once

```ts {all|1-4|7,10|8|9|12-14}
const variants = VariantSchema.make({
  variants: ["select", "insert", "json"],
  defaultVariant: "select",
})

const fields = variants.Struct({
  id: S.Number.pipe(variants.FieldOnly(["select", "json"])),
  email: S.String,
  passwordHash: S.String.pipe(variants.FieldOnly(["select", "insert"])),
  createdAt: S.DateTimeUtc.pipe(variants.FieldOnly(["select", "json"])),
})
export const User = variants.extract(fields, "select")
export const UserInsert = variants.extract(fields, "insert")
export const UserJson = variants.extract(fields, "json")
```

<!--
1. Name the variants once. VariantSchema comes from effect/schema.
2. Generated by the database: read back and returned, never inserted.
3. A plain schema belongs to every variant.
4. Sensitive: stored and written, never returned.
5. Extract an ordinary Schema.Struct per variant.
-->

---

# What you get

```ts
typeof User.Type        // { id, email, passwordHash, createdAt }
typeof UserInsert.Type  // { email, passwordHash }
typeof UserJson.Type    // { id, email, createdAt }

const insert: UserInsert = { id: 1, email, passwordHash } // ✗ id is generated by the database
S.encodeSync(UserJson)(user)                              // { id, email, createdAt }
```

<v-clicks>

- Three ordinary `Schema.Struct`s, typed separately
- Sending a generated column on an insert is a type error
- Encoding a response with `UserJson` leaves `passwordHash` behind

</v-clicks>

<!--
Schemas only emit the fields they declare, so encoding a full User row with UserJson
drops passwordHash. Model, next, adds update and the json create/update variants.

If asked "why not derive them?": mapFields(Struct.omit(…)) handles one field missing
from one variant, but with several variants the rules spread across several
derivations. A variant field keeps the decision next to the field.
-->

---

# In the wild: Model

<p class="eyebrow">effect/schema/Model: the same idea, packaged</p>

```ts
class User extends Model.Class<User>("User")({
  id: Model.GeneratedByDb(S.Number),
  email: S.String,
  passwordHash: Model.Sensitive(S.String),
}) {}
```

```txt
User.select       id, email, passwordHash
User.insert       email, passwordHash
User.update       email, passwordHash
User.json         id, email
User.jsonCreate   email
User.jsonUpdate   email
```

<v-click>

Six variants from one declaration. The id never goes into an insert, and the password hash never leaves the server.

</v-click>

---

# Takeaway

> When one shape shows up in several places, declare its fields once and extract each variant.

<p class="drop-cap">Use <code>VariantSchema</code> to put the "which variants have this field" decision on the field itself. The extracted schemas are ordinary structs, with annotations and checks shared across every variant.</p>

---
layout: chapter
chapter: VIII
accent: gold
---

# Shared configuration

One typed definition of the shared environment

---

# Several services, overlapping env

<p class="eyebrow">Two services in one monorepo</p>

```txt
              STAGE   OTEL_*   STRIPE_API_KEY   OPENAI_API_KEY
service-a     ✓       ✓        ✓
service-b     ✓       ✓                         ✓
```

<v-clicks>

- Every service needs the stage and the telemetry settings
- Each one adds secrets of its own

</v-clicks>

---

# The shared base

<CodeFile path="shared/SharedEnv.ts" label="Shared">

```ts {all|2|4-6|7-9}
export const SharedEnv = Effect.gen(function* () {
  const STAGE = Config.schema(Stage, "STAGE")
  return yield* Config.all({
    STAGE,
    OTEL_EXPORTER_OTLP_ENDPOINT: Config.String("OTEL_EXPORTER_OTLP_ENDPOINT"),
    OTEL_EXPORTER_OTLP_HEADERS: Config.Redacted("OTEL_EXPORTER_OTLP_HEADERS"),
    OTEL_METRICS_EXPORTER: STAGE.pipe(
      Config.map((v) => (v.startsWith("dev_") ? "none" : "otlp")),
    ),
  })
})
```

</CodeFile>

<!--
1. The stage is schema-validated: dev_*, staging-N, or prod.
2. Secrets are Redacted, so they print as <redacted> in logs.
3. Derived values live here too: no metrics exporter on dev stages.
-->

---

# Each service extends it

<CodeFile path="service-a/Env.ts · service-b/Env.ts" label="Per service">

```ts {all|3|4-6|10-18}
export class ServiceAEnv extends Context.Service<ServiceAEnv>()("service-a/Env", {
  make: Effect.gen(function* () {
    const shared = yield* SharedEnv
    return yield* Config.all({
      STRIPE_API_KEY: Config.Redacted("STRIPE_API_KEY"),
    }).pipe(Effect.map(Struct.assign(shared)))
  }),
}) {}

export class ServiceBEnv extends Context.Service<ServiceBEnv>()("service-b/Env", {
  make: Effect.gen(function* () {
    const shared = yield* SharedEnv
    return yield* Config.all({
      OPENAI_API_KEY: Config.Redacted("OPENAI_API_KEY"),
    }).pipe(Effect.map(Struct.assign(shared)))
  }),
}) {}
```

</CodeFile>

<!--
1. Resolve the shared base.
2. Resolve this service's own fields, then merge the base in.
3. Service B: the same base, different additions. Each env is an ordinary service,
   provided with Layer.effect(ServiceAEnv, ServiceAEnv.make).
-->

---

# Consumers just yield it

```ts
const { STRIPE_API_KEY, STAGE } = yield* ServiceAEnv   // Redacted<string>, Stage
const stripe = new Stripe(Redacted.value(STRIPE_API_KEY))
```

<v-clicks>

- One typed object per service, shared fields included
- A missing variable fails at startup, naming the key

</v-clicks>

<!--
Checked on Effect 4.1.2 with ConfigProvider.fromUnknown: each service's object has
its own key plus the shared ones, a logged OTEL_EXPORTER_OTLP_HEADERS prints as
<redacted>, and a missing STRIPE_API_KEY fails with
ConfigError: SchemaError(Expected string at ["STRIPE_API_KEY"]).
-->

---

# Deploy and runtime agree

<CodeFile path="service-a/Worker.ts" label="Alchemy (sketch)">

```ts {all|4|5}
export default class ServiceAWorker extends Cloudflare.Worker<ServiceAWorker>()(
  "ServiceAWorker",
  { /* worker props */ },
  Effect.gen(function* () {
    const layerEnv = yield* ServiceAEnv.make.pipe(Effect.map(Layer.succeed(ServiceAEnv)))
    // … build the HTTP app
    return { fetch: app.pipe(Effect.provide(layerEnv)) }
  }),
) {}
```

</CodeFile>

<v-clicks>

- At deploy, Alchemy runs this init and binds every `Config` it reads onto the Worker as a secret
- At runtime, the same reads resolve from the Worker's environment
- So the deploy and the service can't disagree about what's required

</v-clicks>

<!--
Shape taken from crosshatch's workers. From Alchemy's source at the commit crosshatch
pins: a deploy-time Config interceptor
binds every Config read during Init onto the deploy target, and WorkerConfigProvider
reads them back at runtime.
-->

---

# Secrets into GitHub

<CodeFile path="bootstrap.ts" label="Run once, locally">

```ts {all|3|4-10}
export default Alchemy.Stack(
  "ci-secrets",
  { state: Cloudflare.state(), providers: GitHub.providers() },
  GitHub.Secrets({
    owner: "crosshatch", repository: "monorepo",
    secrets: {
      CLOUDFLARE_API_TOKEN: Config.Redacted("CLOUDFLARE_API_TOKEN"),
      STRIPE_API_KEY: Config.Redacted("STRIPE_API_KEY"),
      OPENAI_API_KEY: Config.Redacted("OPENAI_API_KEY"),
    },
  }),
)
```

</CodeFile>

<v-click>

`alchemy deploy bootstrap.ts` reads your local `.env`, and each `Config.Redacted` becomes a GitHub Actions secret on the repo.

</v-click>

<!--
1. A tiny stack of its own: state in Cloudflare, GitHub as the only provider.
2. GitHub.Secrets accepts Configs and resolves them at deploy time, so the values come
   from .env and are never written in the file.
Imports: alchemy, @alchemy.run/cloudflare, @alchemy.run/github (2.0.0-beta.85; the
GitHub and Cloudflare modules moved out of "alchemy/GitHub" and "alchemy/Cloudflare").
Non-secret values like the Cloudflare account id go in GitHub.Variables the same way.
crosshatch's bootstrap.ts also mints a scoped Cloudflare deploy token
(Cloudflare.ApiToken.AccountApiToken) instead of copying one from .env.
-->

---

# Deploy from CI

<CodeFile path=".github/workflows/deploy.yml" label="Every push">

```yaml {all|4-5}
- run: pnpm alchemy deploy service-a/alchemy.run.ts --stage production
  env:
    CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    STRIPE_API_KEY: ${{ secrets.STRIPE_API_KEY }}
```

</CodeFile>

<v-click>

```txt
.env  →  GitHub secret  →  workflow env  →  Worker secret  →  yield* ServiceAEnv
```

</v-click>

<v-click>

It's the same `Config.Redacted("STRIPE_API_KEY")` all the way down: the bootstrap reads it from `.env`, the deploy from the workflow's env, and the Worker from its own env at runtime.

</v-click>

<!--
1. The workflow maps repo secrets into the deploy step's environment.
2. At deploy, Alchemy binds every Config the Worker's init reads (previous slide) onto
   the Worker as a secret; at runtime ServiceAEnv resolves from there.
Nobody copies a secret by hand after the bootstrap, and a key missing anywhere in the
chain fails with a ConfigError naming it.
-->

---

# Takeaway

> Make the environment a service, built from a shared base that each package extends.

<p class="drop-cap">Each package gets one typed, redacted, validated object, the shared fields are defined exactly once, and the code that deploys a service reads the same definition the service runs with.</p>

---
layout: chapter
chapter: IX
accent: coral
---

# Comparing models

Run the same AI effect in parallel, with a different model for each run.

---

# The models

<CodeFile path="models.ts" label="Layers">

```ts {all|1-3|5-12|14-15}
const anthropic = AnthropicClient.layerConfig({ apiKey: Config.Redacted("ANTHROPIC_API_KEY") })
const openai = OpenAiClient.layerConfig({ apiKey: Config.Redacted("OPENAI_API_KEY") })
const openrouter = OpenRouterClient.layerConfig({ apiKey: Config.Redacted("OPENROUTER_API_KEY") })

const sonnet = AnthropicLanguageModel.layer({ model: "claude-sonnet-5-5" })
  .pipe(Layer.provide(anthropic))
const opus = AnthropicLanguageModel.layer({ model: "claude-opus-5-5" })
  .pipe(Layer.provide(anthropic))
const gpt = OpenAiLanguageModel.layer({ model: "gpt-6.1-sol" })
  .pipe(Layer.provide(openai))
const gemini = OpenRouterLanguageModel.layer({ model: "google/gemini-2.5-flash" })
  .pipe(Layer.provide(openrouter))

const judge = OpenRouterDecisionModel.layer({ model: "~typesafe/jev-latest" })
  .pipe(Layer.provide(openrouter))
```

</CodeFile>

<!--
1. One client layer per provider, each with its own redacted key.
2. Every model is a Layer that provides the same LanguageModel service, whatever the
   provider. (Gemini goes through OpenRouter: there's no Effect 4 Google provider.)
3. The judge is a different service, DecisionModel, also just a layer.
-->

---

# One effect, four models

```ts {1-3|5-10|10}
const idea = LanguageModel.generateText({
  prompt: "Suggest one idea for a venue for the next Effect Miami meetup",
}).pipe(Effect.map((v) => v.text))

const ideas = yield* Effect.all({
  sonnet: idea.pipe(Effect.provide(sonnet)),
  opus: idea.pipe(Effect.provide(opus)),
  gemini: idea.pipe(Effect.provide(gemini)),
  gpt: idea.pipe(Effect.provide(gpt)),
}, { concurrency: "unbounded" })
```

<v-click>

`idea` is a description, not a call. Each copy asks for a `LanguageModel` when it runs, so providing a different model layer gives each one a different model.

</v-click>

<!--
1. Built once. Nothing has run yet.
2. Each copy gets its own model, keyed by name.
3. All four run concurrently.
-->

---

# The decision

<CodeFile path="PickVenue.ts" label="Decision">

```ts {all|2|4-7|6}
const PickVenue = Decision.make({
  input: S.Struct({ sonnet: S.String, opus: S.String, gemini: S.String, gpt: S.String }),
  decisions: {
    best: Decision.classify({
      instructions: "Which venue idea is best for the next Effect Miami meetup?",
      criteria: { sonnet: null, opus: null, gemini: null, gpt: null },
    }),
  },
})
```

</CodeFile>

<!--
1. A decision is data: an input schema, plus named questions about it.
2. The input is exactly the record of ideas from the previous slide.
3. classify picks one label. Here the labels are the candidates, so no descriptions
   are needed (null).
-->

---

# Pick a winner

```ts {all|3|4|5-8}
const program = Effect.gen(function* () {
  const ideas = yield* Effect.all({ /* the four runs */ }, { concurrency: "unbounded" })
  const { answers: { best } } = yield* DecisionModel.decide(PickVenue, { input: ideas })
  return ideas[best.label] // best.label: "sonnet" | "opus" | "gemini" | "gpt"
}).pipe(
  Effect.provide(judge),
  Effect.provide(FetchHttpClient.layer),
)
```

<v-click>

The judge answers with a typed label and a probability for each candidate, not free text to parse. And it's just another layer, swappable like the models it judges.

</v-click>

<!--
Checked with stub models and a stub DecisionModel on Effect 4.1.2: the judge receives
the four ideas as structured state and the classify decision; the label comes back
typed. The real wiring type-checks with nothing left to provide.
-->

---

# Takeaway

> Write the AI effect once, then choose the model by what you provide to it.

<p class="drop-cap">Every provider’s model is a layer for the same <code>LanguageModel</code> service, so comparing them is just <code>Effect.all</code> over copies with different layers. Keep the service lookup inside the effect, so each copy resolves its own.</p>

---
layout: chapter
chapter: X
accent: green
---

# Decision models overview

Four kinds of question a model can answer with a typed answer instead of prose.

---

# Classify

<p class="eyebrow">Pick exactly one label</p>

```ts {all|4-11|15-17}
const RouteTicket = Decision.make({
  input: S.Struct({ subject: S.String, body: S.String }),
  decisions: {
    team: Decision.classify({
      instructions: "Which team should handle this ticket?",
      criteria: {
        billing: "Charges, refunds, invoices, payment methods",
        technical: "Bugs, errors, outages, integrations",
        sales: "Pricing, plans, upgrades, demos",
      },
    }),
  },
})

const { answers } = yield* DecisionModel.decide(RouteTicket, { input: ticket })
answers.team.label          // "billing" | "technical" | "sales"
answers.team.probabilities  // e.g. { billing: 0.94, technical: 0.04, sales: 0.02 }
```

<!--
1. For routing: one of several unordered buckets.
2. The criteria are the labels; descriptions tell the model what each means. Use null
   when a label explains itself, as in PickVenue. At least two labels.
3. The label is typed, and you get a probability for every label, not just the winner.
-->

---

# Rate

<p class="eyebrow">A point on an ordered scale</p>

```ts {all|6-10|15-17}
const AssessReport = Decision.make({
  input: S.Struct({ report: S.String }),
  decisions: {
    severity: Decision.rate({
      instructions: "How severe is the reported issue?",
      criteria: [
        "cosmetic",
        { label: "degraded", description: "Broken, but a workaround exists" },
        { label: "blocking", description: "No workaround exists" },
      ],
    }),
  },
})

const { answers } = yield* DecisionModel.decide(AssessReport, { input: { report } })
answers.severity.label   // the most likely level, e.g. "degraded"
answers.severity.rating  // e.g. 1.3: between degraded (1) and blocking (2)
```

<!--
1. For severity, sentiment, quality: anything where "more" means something.
2. Levels go from lowest to highest. A level is a plain string (label and description
   in one) or { label, description }; descriptions can be structured JSON.
3. Unlike classify, rating is probability-weighted and can fall between levels:
   1.3 is "degraded, leaning blocking".
-->

---

# Probability

<p class="eyebrow">How likely a statement is</p>

```ts {all|5|6-9|14-15}
const Screen = Decision.make({
  input: S.Struct({ message: S.String }),
  decisions: {
    urgent: Decision.probability({
      instructions: "The message is time-sensitive",
      criteria: {
        true: "Someone needs to act within the hour",
        false: "It can wait until the next business day",
      },
    }),
  },
})

const { answers } = yield* DecisionModel.decide(Screen, { input: { message } })
if (answers.urgent.probability > 0.8) yield* pageOnCall(message)
```

<v-click at="3">

You get a number, not a boolean, so the threshold is a decision your code makes.

</v-click>

<!--
1. A statement, not a question.
2. Optional, but if you describe the outcomes, describe both.
3. The cutoff lives in your code, where you can tune it.
-->

---

# Locate

<p class="eyebrow">Find one thing in an image</p>

```ts {all|2|5|4|9-10}
const CheckListing = Decision.make({
  input: S.Struct({ title: S.String, photo: Decision.Image }),
  decisions: {
    hasPlate: Decision.probability({ instructions: "`photo` shows a car's license plate" }),
    plate: Decision.locate({ image: "photo", instructions: "the license plate" }),
  },
})

const { answers } = yield* DecisionModel.decide(CheckListing, { input: listing })
if (answers.hasPlate.probability > 0.5) yield* blur(listing.photo, answers.plate.box)
```

<v-click at="3">

`locate` always returns one box, even when there's nothing to find, so pair it with a `probability` that the target is there.

</v-click>

<!--
1. Decision.Image marks an image field; images are sent to the provider separately.
2. image is the field's path in the encoded input, and can go deep: "frames[2].frame".
   It needs a model created with supportsLocate: true.
3. The pairing the Effect docs recommend.
4. The box is { left, top, right, bottom }, as fractions of the image from the top-left.
-->

---

# Several at once

```ts {all|3-9|12-14}
const Triage = Decision.make({
  input: Ticket,
  decisions: {
    team: Decision.classify({
      instructions: "Which team?", criteria: { billing: null, technical: null },
    }),
    severity: Decision.rate({ instructions: "How severe?", criteria: ["low", "medium", "high"] }),
    urgent: Decision.probability({ instructions: "The ticket is time-sensitive" }),
  },
})

const { outcomes } = yield* DecisionModel.decideSettled(Triage, { input: ticket })
if (Result.isSuccess(outcomes.urgent)) outcomes.urgent.success.probability
else outcomes.urgent.failure.reason // "Missing" | "Refused" | "NoDistribution" | "Invalid"
```

<v-click at="2">

One call answers all three. `decide` fails unless every decision is answered; `decideSettled` returns a `Result` for each, so one refusal doesn't cost you the rest.

</v-click>

<!--
1. Mix any of the four kinds in one definition, asked about the same input.
2. decideSettled: each outcome is a Result of the answer or Unanswered with a reason.
All five examples type-check on Effect 4.1.2. Probabilities shown are illustrative.
-->

---

# Takeaway

> Ask the model a typed question, and get back a typed answer with its probabilities.

<p class="drop-cap">Use <code>classify</code> for one of several labels, <code>rate</code> for a point on an ordered scale, <code>probability</code> for a yes-or-no likelihood, and <code>locate</code> for a box in an image. Combine them in one <code>Decision.make</code>, and reach for <code>decideSettled</code> when a partial answer is still useful.</p>

---
layout: chapter
chapter: XI
accent: plum
---

# Schemas from the model

Ask the model for a schema, then ask it for a value of that schema.

---

# Schemas are values

```txt
generateObject({ schema: Shape })     →  the model describes some fields
hydrate(description)                  →  a real Schema, built at runtime
generateObject({ schema: hydrated })  →  a value, validated against that schema
```

<v-clicks>

- The second response's shape is decided by the first
- Both steps are ordinary structured output
- The only new piece is turning a description back into a `Schema`

</v-clicks>

---

# A naive "metaschema"

<CodeFile path="Shape.ts" label="Metaschema">

```ts {all|1-5|3|7}
const Field = S.Struct({
  name: S.String,
  type: S.Literals(["string", "number", "boolean", "string[]", "number[]"]),
  description: S.String,
})

const Shape = S.Struct({ title: S.String, fields: S.Array(Field) })
```

</CodeFile>

<v-click>

A schema whose values describe schemas.

</v-click>

<!--
1. One field: a name, a type from a closed list, and a description for the model.
2. The closed list of types is the whole vocabulary the model can use.
3. A shape is a titled list of fields.
-->

---

# Hydrate it

<CodeFile path="hydrate.ts" label="Implementation">

```ts {all|1-7|9-13|13}
const types = {
  string: S.String,
  number: S.Finite,
  boolean: S.Boolean,
  "string[]": S.Array(S.String),
  "number[]": S.Array(S.Finite),
} as const

const hydrate = ({ title, fields }: typeof Shape.Type) =>
  S.Struct(Object.fromEntries(fields.map((f) => [
    f.name,
    types[f.type].annotate({ description: f.description }),
  ]))).annotate({ title })
```

</CodeFile>

<!--
1. Each type name maps to a real schema. S.Finite rather than S.Number: S.Number's
   JSON codec also allows "Infinity" and "NaN" strings, which clutters what's sent
   to the model and dropped the field's description.
2. Build a Struct from the described fields, carrying each description along.
3. The title becomes an annotation too, and both reach the model in step two.
-->

---

# Two steps

```ts {all|4-7|8|9-12}
const world = "a story world of sprites, vampires, witches and mermaids"

const program = Effect.gen(function* () {
  const { value: shape } = yield* LanguageModel.generateObject({
    prompt: `Describe the metadata worth tracking for ${world}.`,
    schema: Shape,
  })
  const StoryWorld = hydrate(shape)
  const { value } = yield* LanguageModel.generateObject({
    prompt: `Invent ${world}.`,
    schema: StoryWorld,
  })
  return value
})
```

<!--
1. Step one: structured output against the metaschema.
2. Turn the answer into a schema.
3. Step two: structured output against the schema the model just designed.
-->

---

# What gets sent

<p class="eyebrow">Step two's response schema, as the provider receives it</p>

```json
{
  "type": "object",
  "title": "StoryWorld",
  "properties": {
    "name": { "type": "string", "description": "The world's name" },
    "peoples": {
      "type": "array", "items": { "type": "string" }, "description": "The peoples who live there"
    },
    "magicLevel": { "type": "number", "description": "How common magic is, from 0 to 10" },
    "hasSunlight": { "type": "boolean", "description": "Whether the sun ever rises" }
  },
  "required": ["name", "peoples", "magicLevel", "hasSunlight"], "additionalProperties": false
}
```

```txt
→ {"name":"Hollowtide","peoples":["sprites","vampires","witches","mermaids"],
   "magicLevel":8,"hasSunlight":false}
```

<v-click>

The model's own field descriptions come back to it, and the answer is decoded against them.

</v-click>

<!--
Captured from a run with a stub model, after Anthropic's structured-output transformer.
Reordered "title" to the top for readability.
-->

---

# Takeaway

> Give the model a small, closed vocabulary for describing schemas, and hydrate its answer into a real `Schema`.

<p class="drop-cap">Because a schema is just a value, the shape of one response can come from another.</p>

---
layout: chapter
chapter: XII
accent: blue
---

# Capabilities in metadata

Name a capability with a tag in your data. Whoever provides its layer gets the feature.

---

# Tags are cheap

```ts
type Adapter = (deployment: Deployment) => Effect.Effect<Payload>

class Erc3009 extends Context.Service<Erc3009, Adapter>()("Erc3009") {}
class Permit2 extends Context.Service<Permit2, Adapter>()("Permit2") {}
class SolanaTransfer extends Context.Service<SolanaTransfer, Adapter>()("SolanaTransfer") {}
```

<v-clicks>

- A tag is a key and a type, with no implementation attached
- So it can go anywhere a value can, including plain data
- Each one names a pluggable interface: a way to pay

</v-clicks>

---

# Metadata names capabilities

<CodeFile path="crosshatch/Known/EUR/EURC.ts" label="crosshatch (trimmed)">

```ts {all|5|14}
export const eip155 = {
  8453: {
    asset: Eip155Asset.Eip155Asset.make("0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42", …),
    decimals: 6,
    schemes: [Erc3009Scheme.Erc3009Scheme, Permit2Scheme.Permit2Scheme],
  },
  // … Ethereum, Cronos, World Chain, Avalanche
} as const satisfies References

export const solana = {
  "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": {
    asset: SolanaAsset.SolanaAsset.make("HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr", …),
    decimals: 6,
    schemes: [SolanaScheme.SolanaScheme],
    // …
  },
} as const satisfies References
```

</CodeFile>

<!--
Each deployment of EURC lists the payment schemes it can settle through, as tags.
The asset table says nothing about how to implement them.
-->

---

# Optional, not required

````md magic-move
```ts
const adapter = yield* Erc3009
// Effect<Adapter, never, Erc3009>  →  must be provided
```
```ts
const adapter = yield* Effect.serviceOption(Erc3009)
// Effect<Option<Adapter>>  →  may be provided
```
````

<v-click at="1">

`yield*` on a tag makes it a requirement the type system enforces. `serviceOption` turns it into a question asked at runtime, so code that walks the metadata can ask about any capability without requiring one.

</v-click>

---

# Discover what's provided

```ts {all|3|4|5-7|10}
const pay = Effect.fn(function* (deployments: Record<string, Deployment>) {
  for (const [network, deployment] of Object.entries(deployments)) {
    for (const scheme of deployment.schemes) {
      const adapter = yield* Effect.serviceOption(scheme)
      if (Option.isSome(adapter)) {
        return { network, scheme: scheme.key, payload: yield* adapter.value(deployment) }
      }
    }
  }
  return yield* new NoSupportedScheme()
})
```

<!--
1. Walk the tags the metadata lists.
2. serviceOption asks the context whether that capability was provided.
3. The first provided one wins.
4. Nothing provided is a typed failure, not a crash.
-->

---

# Provide to opt in

```ts
pay(EURC).pipe(Effect.provide(Layer.mergeAll(layerErc3009, layerPermit2)))
```

```txt
erc3009 + permit2     eip155:8453 via Erc3009
permit2 only          eip155:8453 via Permit2
solana only           solana:5eykt4Us… via SolanaTransfer
nothing               NoSupportedScheme
```

<v-click>

The same program, four behaviours. Which layers you provide *is* the configuration: no flags, no registry, no list of enabled schemes to keep in sync.

</v-click>

<!--
Real output on Effect 4.1.2.
-->

---

# Takeaway

> Put capability tags in your metadata, and ask the context which ones were provided.

<p class="drop-cap">Tags are cheap enough to live in plain data, layers decide what's actually supported, and <code>Effect.serviceOption</code> lets one program adapt to whatever it was given.</p>

---
layout: chapter
chapter: XIII
accent: gold
---

# An iframe as an RPC server

Keep secrets on another origin, and talk to them with typed RPC.

---

# Why an iframe

```txt
merchant.example (host page)                  link.crosshatch.dev/enclave (hidden iframe)

FacadeClient ─ RpcClient ─ port1   ⇄   port2 ─ RpcServer ─ handlers  (keys live here)
```

<v-clicks>

- The enclave holds keys and signs payments; the host page is any merchant's site
- The browser's same-origin policy keeps the host out of the enclave's storage
- `postMessage` carries untyped data, but we want typed requests, errors and streams

</v-clicks>

---

# One contract, two packages

<CodeFile path="crosshatch/Browser/FacadeRpcGroup.ts" label="crosshatch">

```ts {all|8-14}
export class FacadeRpcGroup extends RpcGroup.make(
  Rpc.make("StreamState", {
    success: FacadeState,
    stream: true,
  }),
  Rpc.make("Rescind", {}),
  Rpc.make("CreateTrace", { payload: Bridge.TraceConfig }),
  Rpc.make("Propose", {
    payload: Bridge.Proposal,
    success: S.Struct({
      payload: Payload.Payload,
    }),
    error: BrowserProposeError,
  }),
) {}
```

</CodeFile>

<!--
The library defines the contract. The host imports it to build a client; the internal
app imports the same group to implement the server. One schema per call, including a
streaming one and a typed error.
-->

---

# The handshake

```txt
host     mounts a hidden, sandboxed iframe at link.crosshatch.dev/enclave
iframe   parent.postMessage(RequestFacadeIntroduction)               "I'm ready"
host     checks the origin, creates a MessageChannel
host     iframe.postMessage(FacadeIntroduction, origin, [port2])    "here's your end"
both     speak Effect's worker RPC protocol over port1 ⇄ port2
```

<v-click>

A `MessagePort` is exactly what a Web Worker talks over. So Effect's *worker* RPC protocol works unchanged, and the iframe just becomes the worker.

</v-click>

---

# The host side

<CodeFile path="crosshatch/Browser/FacadeWorker.ts" label="crosshatch (trimmed)">

```ts {all|3-9|10-15|16}
export const layer = Effect.gen(function* () {
  const { url } = yield* ChxEnv.ChxEnv
  const requested = yield* BrowserStream.fromEventListenerWindow("message").pipe(
    Stream.filter(({ data, origin }) =>
      origin.startsWith(url({ sub: "link" })) && S.is(RequestFacadeIntroduction)(data)),
    Stream.take(1),
    Stream.runDrain,
    Effect.forkScoped,
  )
  const iframe = document.createElement("iframe")
  Object.assign(iframe, {
    sandbox: "allow-scripts allow-same-origin",
    src: url({ sub: "link", pathname: "enclave" }),
  })
  document.body.appendChild(iframe)
  yield* Fiber.join(requested)
  // …
```

</CodeFile>

<!--
1. Listen first, so the iframe's request can't be missed. Only accept it from the link origin.
2. Mount the hidden iframe. (Trimmed: the real code also sets an id, a 1×1 size and
   off-screen styles.)
3. Wait for "I'm ready".
-->

---

# Hand over a port

<CodeFile path="crosshatch/Browser/FacadeWorker.ts" label="crosshatch (continued)">

```ts {all|2-4|5|6|7-12}
  // …
  const context = yield* Effect.fromNullishOr(iframe.contentWindow)
  const { port1, port2 } = new MessageChannel()
  context.postMessage(FacadeIntroduction.make({}), url({ sub: "link" }), [port2])
  yield* Effect.addFinalizer(() => Effect.sync(() => iframe.remove()))
  return BrowserWorker.layer(() => port1)
}).pipe(
  Effect.retry(
    Schedule.exponential("100 millis", 2).pipe(Schedule.jittered, Schedule.upTo({ times: 6 })),
  ),
  Layer.unwrap,
)
```

</CodeFile>

<!--
1. Transfer port2 to the iframe, addressed to the link origin only.
2. The iframe's lifetime is the layer's lifetime.
3. Hand port1 to Effect as if it were a worker.
4. Flaky mount? Retry the whole handshake with jittered backoff, then unwrap into a layer.
-->

---
zoom: 0.9
---

# The iframe side

<CodeFile path="internal/app/routes/enclave/-serveFacade.ts" label="crosshatch/internal (trimmed)">

```ts {all|2-12|13|14|15-19}
export const serveFacade = Effect.gen(function* () {
  const deferred = yield* Deferred.make<MessagePort>()
  const scope = yield* Scope.make()
  yield* BrowserStream.fromEventListenerWindow("message").pipe(
    Stream.runForEach(Effect.fn(function* ({ data, ports: [port] }) {
      if (port && S.is(FacadeIntroduction)(data)) {
        yield* Deferred.succeed(deferred, port)
        yield* Scope.close(scope, Exit.void)
      }
    })),
    Effect.forkIn(scope, { startImmediately: true }),
  )
  parent.postMessage(RequestFacadeIntroduction.make({}), "*")
  const port = yield* Deferred.await(deferred)
  return yield* RpcServer.layer(FacadeRpcGroup).pipe(
    Layer.provide([layerStreamState, layerCreateTrace, layerPropose, layerRescind,
      RpcServer.layerProtocolWorkerRunner.pipe(Layer.provide(BrowserWorkerRunner.layerMessagePort(port)))]),
    Layer.launch,
  )
})
```

</CodeFile>

<!--
1. Listen for the introduction in a scope of its own, and close that scope as soon as
   the port arrives, so the listener doesn't outlive its job.
2. "I'm ready." The message carries no data, so "*" is fine here.
3. Wait for the port.
4. Serve the same group over it. layerPropose is where the user reviews and signs.
-->

---

# The client is ordinary

<CodeFile path="crosshatch/Browser/FacadeClient.ts" label="crosshatch">

```ts {all|2|4}
export class FacadeClient extends Context.Service<FacadeClient>()("crosshatch/FacadeClient", {
  make: RpcClient.make(FacadeRpcGroup),
}) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(
      RpcClient.layerProtocolWorker({ size: 1 }).pipe(Layer.provide(FacadeWorker.layer)),
    ),
  )
}
```

</CodeFile>

```ts
const client = yield* FacadeClient
const { payload } = yield* client.Propose(proposal) // typed success, typed error
```

<v-click>

Everything iframe-specific lives in one layer. Code that uses the client just sees typed RPC.

</v-click>

<!--
Checked on Effect 4.1.2 with @effect/platform-browser 4.1.2: a real RpcClient and
RpcServer joined only by a MessageChannel, no iframe. Request/response and streaming
both work. The protocol only ever sees a port.
-->

---

# Takeaway

> Put sensitive code behind an origin boundary, and connect to it with the same RPC you'd use for a worker.

<p class="drop-cap">The library owns the contract and the client layer, the iframe owns the implementation, and a transferred <code>MessagePort</code> is all that joins them. Everything else is ordinary Effect: schemas, typed errors, streams and scopes.</p>

---
layout: chapter
chapter: XIV
accent: green
---

# Layers that register

Providing a layer can fill an implicit registry, instead of providing a service.

---

# A registry nobody has to provide

```ts
type Handler = (input: string) => Effect.Effect<string>

class HandlerRegistry extends Context.Reference<Map<string, Handler>>("app/HandlerRegistry", {
  defaultValue: () => new Map(),
}) {}
```

<v-clicks>

- A `Context.Reference` always has a value, so `yield* HandlerRegistry` never fails
- The value is a plain, mutable `Map`
- Anything that yields it sees the same instance

</v-clicks>

---

# A layer that provides nothing

<CodeFile path="layerHandler.ts" label="Implementation">

```ts {all|3|4-5|6}
const layerHandler = <R>(name: string, f: (input: string) => Effect.Effect<string, never, R>) =>
  Effect.gen(function* () {
    const registry = yield* HandlerRegistry
    const context = yield* Effect.context<R>()
    registry.set(name, flow(f, Effect.provideContext(context)))
    return Layer.empty
  }).pipe(Layer.unwrap)
```

</CodeFile>

<!--
1. Grab the implicit registry.
2. Store the handler with its context captured (Chapter IV), so whoever calls it later
   doesn't need to provide its dependencies.
3. The layer's output is empty. Building it is the whole point.
-->

---

# Look up late

```ts
const dispatch = Effect.fn(function* (name: string, input: string) {
  const registry = yield* HandlerRegistry
  const handler = registry.get(name)
  return handler ? yield* handler(input) : `no handler for "${name}"`
})

const upper = layerHandler("upper", (s) => Effect.succeed(s.toUpperCase()))
dispatch("upper", "hi").pipe(Effect.provide(upper)) // "HI"
```

<v-click>

Providing `upper` adds no service. It adds an entry to a `Map` the consumer already holds. Look entries up when a handler is actually needed, and layer order stops mattering.

</v-click>

<!--
Layer order: a consumer built before the handler layer and one built after both found
the handler. Checked with a Payer-like consumer that captures the registry at build time and looks
handlers up at call time, merged with the handler layer in both orders.
-->

---

# In the wild

<CodeFile path="crosshatch/Extension.ts · crosshatch/Payer.ts" label="crosshatch (trimmed)">

```ts {all|1-5|7-12|14-16}
export class ExtensionRegistry extends Context.Reference<
  Map<Extension.Any, (payload: ExtensionHandlerConfig<any>) => Effect.Effect<unknown>>
>("crosshatch/ExtensionRegistry", {
  defaultValue: () => new Map(),
}) {}

export const layerHandler = Effect.fnUntraced(function* (extension, f) {
  const registry = yield* ExtensionRegistry
  const context = yield* Effect.context<R>()
  registry.set(extension, flow(f, Effect.provide(Layer.succeedContext(context)), Effect.scoped))
  return Layer.empty
}, Layer.unwrap)

// Payer.layerLocal: holds the Map, looks extensions up per payload
const registry = yield* ExtensionRegistry
const extension = registry.entries().find(([extension]) => extension.identifier === identifier)
```

</CodeFile>

<!--
Clients answer x402 extension requests by providing Extension.layerHandler(...) layers
next to Payer.layerLocal. Trimmed: the real layerHandler is generic over the extension's
types. The Effect.scoped placement here is the Chapter IV trap: the captured layer
Scope shadows it.
-->

---

# Sharp edges

```txt
a separate run, no handler layer      "HI"         the default Map is shared by the whole process
a run with a fresh Map                "no handler"
after the registering layer closes    ["shout"]    the handler is still there
```

<v-click>

```ts
// one registry per app, or per test
program.pipe(Effect.provide(Layer.succeed(HandlerRegistry, new Map())))

// unregister when the layer's scope closes
registry.set(name, handler)
yield* Effect.addFinalizer(() => Effect.sync(() => registry.delete(name)))
```

</v-click>

<!--
Effect 4.1.2 caches a Reference's default on the Reference itself, so `defaultValue`
runs once and every run that doesn't provide its own value shares it. All three rows
are real output; the finalizer version leaves the Map empty after the run.
-->

---

# Takeaway

> Let a layer register into an implicit, `Context.Reference`-backed registry, and look entries up when they're needed.

<p class="drop-cap">Providing the layer becomes the act of plugging something in. Just remember the default is one shared map: provide a fresh one per app or test, and unregister on scope close if layers come and go.</p>
