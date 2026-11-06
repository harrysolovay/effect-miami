---
title: Advanced Effect Design Patterns
theme: default
colorSchema: auto
layout: cover
eyebrow: Effect Miami
byline: By Harry Solovay
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

```ts
class NotFound extends S.TaggedError<NotFound>()("NotFound", {
  id: S.String,
}) {}

class Clock extends Context.Service<Clock, {
  readonly now: Effect.Effect<number>
}>()("app/Clock") {}
```

<v-click>

`<Self>()(id, …)` returns a class built from your arguments. Nothing stops *us* from writing functions with the same shape.

</v-click>

<!--
Both of these are calls that return a class. Self goes first in its own call because
TypeScript can't infer some type arguments while you write others explicitly.
-->

---

# One topic per event

<p class="eyebrow">Written by hand</p>

```ts {all|1-2|4-5|7}
class OrderPlaced extends Context.Service<OrderPlaced, PubSub.PubSub<Order>>()("app/OrderPlaced") {}
const OrderPlacedLive = Layer.effect(OrderPlaced, PubSub.unbounded<Order>())

class OrderShipped extends Context.Service<OrderShipped, PubSub.PubSub<Order>>()("app/OrderShipped") {}
const OrderShippedLive = Layer.effect(OrderShipped, PubSub.unbounded<Order>())

// … and again for every event
```

<v-clicks>

- The same two lines, copied for every event
- The schema lives somewhere else
- Each layer has to be found and wired separately

</v-clicks>

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
1. Self is explicit, in its own call, same as S.TaggedError.
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
export class OrderPlaced extends Topic.Service<OrderPlaced>()("app/OrderPlaced", Order) {}
export class OrderShipped extends Topic.Service<OrderShipped>()("app/OrderShipped", Order) {}
export class UserSignedUp extends Topic.Service<UserSignedUp>()("app/UserSignedUp", User) {}
```

<v-clicks>

- One line per event
- The schema is declared right next to the event
- `OrderPlaced.layer` and `OrderPlaced.schema` come with the class

</v-clicks>

---

# Yield it like any service

```ts {1-4|5|7}
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

Annotate the factory's return type with it, and the type shows up by name in hovers and docs. The `new` signature is what keeps the result extendable as a class.

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
- Options shrink to what every provider has in common
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

```ts {all|1|3-5|9|10|11}
export type TraitsConfig = typeof TraitsConfig.Type
export const TraitsConfig = S.Struct({
  layerLanguageModel: S.declare(
    (u): u is Layer.Layer<LanguageModel.LanguageModel, unknown, HttpClient.HttpClient> => Layer.isLayer(u),
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

```ts {1-4|5}
const review = Effect.gen(function* () {
  const response = yield* LanguageModel.generateText({ prompt: "Does this diff follow the trait?" })
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

<p class="drop-cap">The Layer is the extension point. Any implementation of the service works, along with whatever it depends on, and <code>S.declare</code> keeps the boundary validated like any other input.</p>

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

```ts {all|2|3|4}
const program = Effect.gen(function* () {
  const chat = yield* Chat.Chat
  yield* chat.generateText({ prompt: "Today we're going to review some code." })
  yield* chat.generateText({ prompt: "Here's the first file: …" }) // sees the first exchange
})
```

<v-click>

Every `generateText` appends to the same history. So what happens when three experts should review the code *in parallel*, each picking up from this point?

</v-click>

<!--
Chat.Chat is an ordinary service. Its history is a Ref<Prompt>, and each call reads
from and appends to it. Sharing one chat across concurrent fibers would mix all the
experts into one conversation.
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

# One expert

```ts
const suggestion = Effect.fn(function* (code: string, expert: string) {
  const chat = yield* Chat.Chat
  const { text } = yield* chat.generateText({
    prompt: `You are an expert ${expert}. Please provide feedback on the following code:\n\n${code}`,
  })
  return text
})
```

<v-click>

`suggestion` has no idea it might run in a branch. It just asks for `Chat.Chat`.

</v-click>

---

# Fan out

```ts {all|5-9|11-12|14-17}
const program = Effect.gen(function* () {
  const chat = yield* Chat.Chat
  yield* chat.generateText({ prompt: "Today we're going to review some code." })

  const experts = ["security researcher", "developer experience engineer", "developer advocate"]
  const suggestions = yield* Effect.all(
    experts.map((expert) => suggestion(code, expert).pipe(branch)),
    { concurrency: "unbounded" },
  )

  const { content } = yield* Ref.get(chat.history)
  console.log(content.length) // outer conversation is unaffected
  return suggestions
}).pipe(
  Effect.provideServiceEffect(Chat.Chat, Chat.empty),
  Effect.provide(TraitsConfig.layer),
)
```

<!--
1. Each expert runs concurrently, each with its own copy of the outer chat.
2. The outer chat still has just the opening exchange.
3. Provide an empty Chat to start, and the LanguageModel from Chapter II's
   TraitsConfig.layer.
-->

---

# What each chat sees

```txt
outer chat     2 messages   the opening exchange
each branch    4 messages   the opening exchange + its own review
```

<v-clicks>

- Every branch starts from the outer chat's history
- Branches never see each other's messages
- The outer conversation stays exactly as it was

</v-clicks>

<!--
Checked by running this exact branch function against a stub LanguageModel: the
outer chat stays at 2 messages while each branch grows to 4.
-->

---

# Takeaway

> Because the chat is a service, branching a conversation is just providing a different one.

<p class="drop-cap">Since <code>Effect.provideServiceEffect</code> scopes the replacement to a single effect, code that uses the chat never knows. Concurrency and history isolation come from Effect itself rather than from the AI library.</p>

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

```ts {1-3|6-7|10-13}
class Hooks extends Context.Reference<Map<string, (payload: string) => Effect.Effect<void>>>("app/Hooks", {
  defaultValue: () => new Map(),
}) {}

// at startup
const hooks = yield* Hooks
hooks.set("order.placed", saveOrder) // ✗ Effect<void, never, Database> is not Effect<void>

// much later, inside the server
const dispatch = Effect.fn(function* (event: string, payload: string) {
  const hook = (yield* Hooks).get(event)
  if (hook) yield* hook(payload)
})
```

<v-click>

The hook is registered at one point in the lifecycle and run at another, by code with a different context. The type error is right: nobody will be there to provide `Database`.

</v-click>

---

# Capture the context

<CodeFile path="Hooks.ts" label="Implementation">

```ts {all|7|8|13}
export const layerHook = Effect.fnUntraced(function* <R>(
  name: string,
  f: (payload: string) => Effect.Effect<void, never, R>,
) {
  const hooks = yield* Hooks

  const context = yield* Effect.context<R>()
  hooks.set(name, flow(f, Effect.provideContext(context)))
  return Layer.empty
}, Layer.unwrap)

// R is tracked on the layer, so it's provided like anything else
layerHook("order.placed", saveOrder).pipe(Layer.provide(Database.layer))
```

</CodeFile>

<!--
1. While the layer is being built, grab the context the hook will need.
2. Store a version of the hook that brings its own context along.
3. The hook's requirements become the layer's requirements, so the type system
   still makes sure Database is provided.
-->

---

# In the wild

<CodeFile path="crosshatch/Extension.ts" label="crosshatch">

```ts {all|12|13|14}
export const layerHandler = Effect.fnUntraced(function* <
  Self,
  Id extends string,
  Identifier extends string,
  Info extends Extension.Info,
  Enrichment extends Extension.Enrichment<Info>,
  R,
>(
  extension: Extension<Self, Id, Identifier, Info, Enrichment>,
  f: (payload: ExtensionHandlerConfig<Info>) => Effect.Effect<Enrichment["Type"], never, R>,
) {
  const registry = yield* ExtensionRegistry
  const context = yield* Effect.context<R>()
  registry.set(extension, flow(f, Effect.provide(Layer.succeedContext(context)), Effect.scoped))
  return Layer.empty
}, Layer.unwrap)
```

</CodeFile>

<!--
Same shape: a client registers extension handlers at startup, and the payer calls them
later while building a payment payload. Note the Effect.scoped at the end; we'll
come back to it.
-->

---

# What gets captured

```ts {1|2|4-5}
const context = yield* Effect.context<Database>() // typed Context<Database>…
                                                   // …but holds everything in scope

const onlyDb = Context.pick(Database)(context)     // holds just Database
const noScope = Context.omit(Scope.Scope)(context) // everything but the Scope
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

```ts {1|3-6|8-9}
flow(f, Effect.provideContext(context), Effect.scoped)

const auditOrder = Effect.fn(function* (payload: string) {
  yield* Effect.acquireRelease(open(payload), () => close(payload))
  yield* saveOrder(payload)
})

// after one dispatch:   open o_1, insert o_1
// after app shutdown:   open o_1, insert o_1, close o_1
```

<v-click>

The context was captured while the layer was being built, so it includes the *layer's* `Scope`. That captured `Scope` shadows the fresh one from `Effect.scoped`, and every resource a hook opens stays open until the app shuts down.

</v-click>

---

# Order matters

````md magic-move
```ts
flow(f, Effect.provideContext(context), Effect.scoped)

// after one dispatch:   open o_1, insert o_1
// after app shutdown:   open o_1, insert o_1, close o_1
```
```ts
flow(f, Effect.scoped, Effect.provideContext(context))

// after one dispatch:   open o_1, insert o_1, close o_1
```
````

<v-click at="1">

The innermost provide wins. Providing the fresh `Scope` first, closest to `f`, gives each call its own, while everything else still comes from the captured context.

</v-click>

<!--
Both orderings type-check, which is what makes this easy to miss. Verified by running
both against Effect 4.1.2.
-->

---

# Takeaway

> When an effect runs outside the fiber that defined it, capture its context explicitly, and choose what goes with it.

<p class="drop-cap">Grab the context with <code>Effect.context</code> where the effect is defined, and re-provide it where it runs. Since it captures everything in scope, decide what to leave behind with <code>Context.pick</code> or <code>Context.omit</code>, or by ordering, and keep the <code>Scope</code> local to each run.</p>

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
  const { id } = yield* HttpRouter.params
  const user = yield* findUser(id!)
  return yield* HttpServerResponse.json(user)
}).pipe(
  Effect.catchTag("UserNotFound", (e) =>
    HttpServerResponse.json({ error: "UserNotFound", id: e.id }, { status: 404 })),
)
```

<v-clicks>

- Every handler repeats the same mapping
- Forget one, and a domain error turns into a 500
- The wire format drifts from route to route

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
  const { id } = yield* HttpRouter.params
  const user = yield* findUser(id!) // may fail with UserNotFound
  return yield* HttpServerResponse.json(user)
})
```

<v-click>

No `catchTag`, no status code. The error stays in the typed error channel, and the server asks it for a response.

</v-click>

---

# What the server sends

```txt
GET /users/1   200  application/json   {"id":"1","name":"Ada"}
GET /users/2   404  application/json   {"error":"UserNotFound","id":"2"}
GET /plain     500                     (an error with no Respondable)
```

<v-clicks>

- A respondable error becomes exactly the response it describes
- Anything else still falls back to a 500

</v-clicks>

<!--
Real output: these routes served through HttpRouter.toWebHandler and called with
Request objects, on Effect 4.1.2.
-->

---

# Expected, not reported

```txt
UserNotFound   404   [ErrorReporter.ignore] = true   not reported
Forbidden      403   respondable, not ignored        reported
Plain          500   neither                         reported
```

<v-click>

A 404 is a normal outcome, not an incident. Marking the error `ignore` keeps it out of every reporter, without changing the response it renders.

</v-click>

<!--
Verified with an ErrorReporter installed at the app level: only Forbidden and Plain
reached it. Reporters built with ErrorReporter.make skip anything marked ignore.
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

# In the wild

<CodeFile path="crosshatch/ChxHttp.ts" label="crosshatch (trimmed)">

```ts {all|10|11-12|16}
export class PaymentRequired
  extends Data.TaggedError("PaymentRequired")<{
    readonly required: Required
    readonly request: HttpServerRequest.HttpServerRequest
  }>
  implements HttpServerRespondable.Respondable
{
  [HttpServerRespondable.symbol]() {
    return Effect.gen({ self: this }, function* () {
      const traceInfo = yield* /* current span's trace + span ids, if any */
      const required = yield* S.encodeEffect(RequiredFromBase64JsonString)(this.required)
      return HttpServerResponse.empty({ status: 402, headers: { [PAYMENT_REQUIRED]: required, ...traceInfo } })
    })
  }

  override readonly [ErrorReporter.ignore] = true
}
```

</CodeFile>

<!--
An x402 402 Payment Required. Rendering can itself be effectful: it reads the current
span for trace headers and schema-encodes the payment requirements into a header.
Handlers just call require(...), which yields this error.
-->

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
