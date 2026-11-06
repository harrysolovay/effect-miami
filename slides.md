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

<!--
1. A private staging directory, created next to the target.
2. Write the whole file there, where nobody is looking.
3. link publishes it in one step, and fails if the name is already taken. That failure
   is the existence check, so there's no gap between checking and writing.
   catchReason picks the AlreadyExists reason out of PlatformError.
4. Effect.scoped closes the scope when the write ends, which deletes the staging
   directory along with the staged copy.
-->

---

# The Scope does the cleanup

```txt
create, file is new         a.md                    staging directory removed
create, file exists         FileAlreadyExists       staging directory removed
failure before link         target untouched        staging directory removed
interrupted mid-write       target untouched        staging directory removed
```

<v-click>

`makeTempDirectoryScoped` ties the staging directory to the `Scope`, so it's deleted however the write ends: success, failure, or interruption.

</v-click>

<!--
All four cases run against a real directory on Effect 4.1.2 with NodeServices.
-->

---

# Why stage next to the target

<v-clicks>

- `link` and `rename` only work within one file system, so staging in `/tmp` can fail
- A directory beside the target is guaranteed to be on the same one
- The `.write-` prefix keeps it out of watchers looking for `*.md`

</v-clicks>

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

# Racing writers

```txt
                     10 concurrent creates of race.md
check, then write    10 report success      file holds whoever finished last
stage, then link      1 succeeds            9 get FileAlreadyExists
```

<v-click>

The atomic version doesn't need a lock or a retry. The file system's own `link` decides the winner.

</v-click>

---

# In the wild

<CodeFile path="traits/TraitStore.ts" label="Traits">

```ts {all|2-5|7|8-15|16}
Effect.gen(function* () {
  const directory = yield* fs.makeTempDirectoryScoped({
    directory: traitsDirectory,
    prefix: ".traits-write-",
  })
  const temporary = path.join(directory, `${trait.name}.md`)
  yield* fs.writeFileString(temporary, Trait.serialize(trait))
  yield* fs.link(temporary, traitPath(trait.name)).pipe(
    Effect.catchTags({
      PlatformError: (error) =>
        error.reason._tag === "AlreadyExists"
          ? TraitAlreadyExistsError.make({ traitName: trait.name })
          : error,
    }),
  )
}).pipe(Effect.scoped)
```

</CodeFile>

<!--
Traits stores each trait as a Markdown file that a watcher reacts to. The staging prefix
doesn't end in .md, so the watcher never sees the half-written copy. Same shape as our
create; catchReason is the shorter way to write that catchTags.
-->

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

Every export of `VariantSchema` is marked `@stability unstable`, and so is `Model`, which is built on it. The API may still change.

<v-click>

<p class="drop-cap">Even so, it’s so awesome that it’s worth reaching for anyway. Pin your Effect version, and enjoy.</p>

</v-click>

<!--
Checked in Effect 4.1.2: all 26 stability tags in VariantSchema.d.ts and all 57 in
Model.d.ts say unstable.
-->

---

# One record, three shapes

<p class="eyebrow">A user row in the database</p>

```txt
           id    email    passwordHash    displayName    createdAt
select     ✓     ✓        ✓               ✓              ✓
insert           ✓        ✓               optional
update           ✓        ✓               optional
```

<v-clicks>

- The database generates `id` and `createdAt`, so they only come back on `select`
- `displayName` has a database default, so writes may leave it out
- Three schemas that have to agree on every other field

</v-clicks>

---

# Define once

<CodeFile path="User.ts" label="Implementation">

```ts {all|1-4|7|8-9|10-14|18-20}
const variants = VariantSchema.make({
  variants: ["select", "insert", "update"],
  defaultVariant: "select",
})

const fields = variants.Struct({
  id: S.Number.pipe(variants.FieldOnly(["select"])),
  email: S.String,
  passwordHash: S.String,
  displayName: variants.Field({
    select: S.String,
    insert: S.optional(S.String),
    update: S.optional(S.String),
  }),
  createdAt: S.DateTimeUtc.pipe(variants.FieldOnly(["select"])),
})

export const User = variants.extract(fields, "select")
export const UserInsert = variants.extract(fields, "insert")
export const UserUpdate = variants.extract(fields, "update")
```

</CodeFile>

<!--
1. Name the variants once. VariantSchema comes from effect/schema.
2. FieldOnly: id only exists when reading.
3. A plain schema belongs to every variant.
4. Field gives each variant its own schema: required on select, optional on writes.
5. Extract an ordinary Schema.Struct per variant.
-->

---

# What you get

```ts
typeof User.Type        // { id, email, passwordHash, displayName, createdAt }
typeof UserInsert.Type  // { email, passwordHash, displayName? }
typeof UserUpdate.Type  // { email, passwordHash, displayName? }

const insert: UserInsert = { id: 1, email, passwordHash } // ✗ id is not part of an insert
S.decodeUnknownSync(UserInsert)({ id: 9, email, passwordHash })  // { email, passwordHash }
```

<v-clicks>

- Three ordinary `Schema.Struct`s, typed separately
- Sending a generated column on a write is a type error
- Decoding a write strips anything the variant doesn't declare

</v-clicks>

<!--
All checked on Effect 4.1.2, including a @ts-expect-error on an insert with an id.
Like Model, the update variant leaves id out; the id goes in the WHERE clause.
-->

---

# Why not derive them?

<v-clicks>

- `mapFields(Struct.omit(…))` handles one field missing from one variant
- With three variants and per-variant optionality, the rules spread across several derivations
- A variant field keeps the decision next to the field it's about

</v-clicks>

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
User.select       id, email, passwordHash      User.json         id, email
User.insert       email, passwordHash          User.jsonCreate   email
User.update       email, passwordHash          User.jsonUpdate   email
```

<v-click>

Six variants from one declaration. The id never goes into an insert, and the password hash never leaves the server.

</v-click>

---

# A field is a variant map

<CodeFile path="effect/schema/Model.ts" label="Effect">

```ts {all|1-4|6-10}
export const GeneratedByDb = (schema) => Field({
  select: schema,
  json: schema,
})

export const Sensitive = (schema) => Field({
  select: schema,
  insert: schema,
  update: schema,
})
```

</CodeFile>

<v-click>

`Field` maps each variant to a schema, so a field can be absent from some variants or even take a different schema in each. `FieldOnly` is shorthand for the same schema in a few of them.

</v-click>

<!--
Simplified from the compiled source: the real definitions add types. Model's variants
are select, insert, update, json, jsonCreate and jsonUpdate, with select as the default.
-->

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

One typed definition of the environment, shared by every service and by the code that deploys them.

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
- Reading `process.env` in each package drifts the moment one changes

</v-clicks>

---

# The shared base

<CodeFile path="shared/SharedEnv.ts" label="Shared">

```ts {all|2|4-6|7}
export const SharedEnv = Effect.gen(function* () {
  const STAGE = Config.schema(Stage, "STAGE")
  return yield* Config.all({
    STAGE,
    OTEL_EXPORTER_OTLP_ENDPOINT: Config.String("OTEL_EXPORTER_OTLP_ENDPOINT"),
    OTEL_EXPORTER_OTLP_HEADERS: Config.Redacted("OTEL_EXPORTER_OTLP_HEADERS"),
    OTEL_METRICS_EXPORTER: STAGE.pipe(Config.map((v) => (v.startsWith("dev_") ? "none" : "otlp"))),
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

```txt
service-a  STRIPE_API_KEY, STAGE, OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_EXPORTER_OTLP_HEADERS, OTEL_METRICS_EXPORTER
service-b  OPENAI_API_KEY, STAGE, OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_EXPORTER_OTLP_HEADERS, OTEL_METRICS_EXPORTER
logged     OTEL_EXPORTER_OTLP_HEADERS → <redacted>
missing    ConfigError: SchemaError(Expected string at ["STRIPE_API_KEY"])
```

<v-clicks>

- One typed object per service, shared fields included
- Secrets stay redacted until you explicitly unwrap them
- A missing variable fails at startup, naming the key

</v-clicks>

<!--
Real output on Effect 4.1.2 with ConfigProvider.fromUnknown.
-->

---

# Mind the order

````md magic-move
```ts
make: SharedEnv.pipe(
  Effect.map(Struct.assign({ STRIPE_API_KEY: Config.Redacted("STRIPE_API_KEY") })),
)
// STRIPE_API_KEY is still a Config, not a Redacted
```
```ts
make: Effect.gen(function* () {
  const shared = yield* SharedEnv
  return yield* Config.all({ STRIPE_API_KEY: Config.Redacted("STRIPE_API_KEY") }).pipe(
    Effect.map(Struct.assign(shared)),
  )
})
// STRIPE_API_KEY is a Redacted<string>
```
````

<v-click at="1">

Merging `Config`s into already-resolved values never reads them. Resolve the service's own `Config.all` first, then merge the shared values in.

</v-click>

<!--
Both checked at runtime: the first leaves an unresolved Config object in the service.
link/LinkEnv.ts at this revision has the first shape; nothing reads its own fields
yet, so it's latent. Under Alchemy it likely also means those keys are never bound
to the Worker, since only Configs read during init are.
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

# In the wild

<CodeFile path="internal-util/InternalEnv.ts" label="crosshatch (trimmed)">

```ts {all|2-6|8-9|13}
export const InternalEnv = Effect.gen(function* () {
  const CHX_INTERNAL_STAGE = yield* Alchemy.Stage.pipe(
    Effect.flatMap(S.decodeUnknownEffect(ChxStage.Stage)),
    Effect.orDie,
    Effect.map(Config.succeed),
  )
  return yield* Config.all({
    CHX_INTERNAL_STAGE,
    VITE_PUBLIC_CHX_INTERNAL_STAGE: CHX_INTERNAL_STAGE,
    OTEL_EXPORTER_OTLP_ENDPOINT: Config.string("OTEL_EXPORTER_OTLP_ENDPOINT"),
    OTEL_EXPORTER_OTLP_HEADERS: Config.redacted("OTEL_EXPORTER_OTLP_HEADERS"),
    OTEL_TRACES_EXPORTER: Config.succeed("otlp"),
    OTEL_METRICS_EXPORTER: CHX_INTERNAL_STAGE.pipe(Config.map((v) => (v.startsWith("dev_") ? "none" : "otlp"))),
  })
})
```

</CodeFile>

<!--
1. The stage comes from the Alchemy stack itself, validated against ChxStage.Stage.
2. The same stage is exposed to the Vite frontend under a VITE_PUBLIC_ name.
3. Derived values. (Trimmed: OTEL_LOGS_EXPORTER is set the same way as traces.)
This repo is on an Effect 4 RC, where the constructors are still lowercase.
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

```ts {all|1-3|5-8|9}
const anthropic = AnthropicClient.layerConfig({ apiKey: Config.Redacted("ANTHROPIC_API_KEY") })
const openai = OpenAiClient.layerConfig({ apiKey: Config.Redacted("OPENAI_API_KEY") })
const openrouter = OpenRouterClient.layerConfig({ apiKey: Config.Redacted("OPENROUTER_API_KEY") })

const sonnet = AnthropicLanguageModel.layer({ model: "claude-sonnet-5-5" }).pipe(Layer.provide(anthropic))
const opus = AnthropicLanguageModel.layer({ model: "claude-opus-5-5" }).pipe(Layer.provide(anthropic))
const gpt = OpenAiLanguageModel.layer({ model: "gpt-6.1-sol" }).pipe(Layer.provide(openai))
const gemini = OpenRouterLanguageModel.layer({ model: "google/gemini-2.5-flash" }).pipe(Layer.provide(openrouter))
const judge = OpenRouterDecisionModel.layer({ model: "~typesafe/jev-latest" }).pipe(Layer.provide(openrouter))
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
}).pipe(Effect.map(({ text }) => text))

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

# The metaschema

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

A schema whose values describe schemas. It's deliberately flat, so every provider's structured-output mode accepts it and enforces it.

</v-click>

<!--
1. One field: a name, a type from a closed list, and a description for the model.
2. The closed list of types is the whole vocabulary the model can use.
3. A shape is a titled list of fields.
-->

---

# Hydrate it

<CodeFile path="hydrate.ts" label="Implementation">

```ts {all|1-7|9-11|11}
const types = {
  string: S.String,
  number: S.Finite,
  boolean: S.Boolean,
  "string[]": S.Array(S.String),
  "number[]": S.Array(S.Finite),
} as const

const hydrate = ({ title, fields }: typeof Shape.Type) =>
  S.Struct(Object.fromEntries(fields.map((f) => [f.name, types[f.type].annotate({ description: f.description })])))
    .annotate({ title })
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

```ts {all|2-5|6|7-10}
const program = Effect.gen(function* () {
  const { value: shape } = yield* LanguageModel.generateObject({
    prompt: "Describe the metadata worth tracking for a story world of sprites, vampires, witches and mermaids.",
    schema: Shape,
  })
  const StoryWorld = hydrate(shape)
  const { value } = yield* LanguageModel.generateObject({
    prompt: "Invent a story world of sprites, vampires, witches and mermaids.",
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
    "peoples": { "type": "array", "items": { "type": "string" }, "description": "The peoples who live there" },
    "magicLevel": { "type": "number", "description": "How common magic is, from 0 to 10" },
    "hasSunlight": { "type": "boolean", "description": "Whether the sun ever rises" }
  },
  "required": ["name", "peoples", "magicLevel", "hasSunlight"],
  "additionalProperties": false
}
```

```txt
→ {"name":"Hollowtide","peoples":["sprites","vampires","witches","mermaids"],"magicLevel":8,"hasSunlight":false}
```

<v-click>

The model's own field descriptions come back to it as part of the schema, and the answer is decoded against it like any other.

</v-click>

<!--
Captured from a run with a stub model, after Anthropic's structured-output transformer.
Reordered "title" to the top for readability.
-->

---

# Why not raw JSON Schema?

```txt
                              Anthropic   OpenAI     Problem
raw JSON Schema (S.Json)      accepted    accepted   unenforced; invalid ones accept anything
recursive metaschema          rejected    accepted   not portable
flat metaschema               accepted    accepted   —
```

<v-click>

`SchemaRepresentation.fromJsonSchemaDocument` assumes its input is valid. Given `{ "type": "objekt" }`, it quietly imports a schema that accepts everything. Constrain what the model writes, then build the schema yourself.

</v-click>

<!--
All checked offline on Effect 4.1.2, running each provider's own structured-output
transformer. The importer does keep real constraints (minimum became a check) and
rejects regex patterns by default, so it's a fine target once step one is enforced.
-->

---

# Takeaway

> Give the model a small, closed vocabulary for describing schemas, and hydrate its answer into a real `Schema`.

<p class="drop-cap">Because a schema is just a value, the shape of one response can come from another. Keep the metaschema flat so every provider enforces it, and validate everything that comes back.</p>
