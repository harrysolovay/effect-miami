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

# The familiar shape

<p class="eyebrow">One service, written by hand</p>

```ts
class Clock extends Context.Service<Clock, {
  readonly now: Effect.Effect<number>
}>()("app/Clock") {}

const program = Effect.gen(function* () {
  const clock = yield* Clock
  return yield* clock.now
})
```

<v-click>

Works well for one service. But what about a *family* of services that share structure: an identifier, a pair of schemas, and decoders derived from those schemas?

</v-click>

<!--
Start from what everyone already writes. The question is what to do when ten services
all need the same extra machinery attached.
-->

---

# The goal

<p class="eyebrow">crosshatch/Extensions/PaymentId.ts</p>

```ts
export class FromMerchant extends Extension.Service<FromMerchant>()("crosshatch/FromMerchant", {
  identifier: "payment-identifier",
  info: S.Struct({
    required: S.tag(true),
    id: PaymentId,
  }),
  enrichment: S.Struct({
    required: S.tag(true),
    id: PaymentId,
  }),
}) {}
```

<v-clicks>

- Declared like an ordinary `Context.Service` class
- Parameterised by an id **and** a definition of schemas
- Comes with typed decoders and metadata attached

</v-clicks>

<!--
Show the destination first. A merchant declares an x402 extension: what it asks for (info)
and what the payer sends back (enrichment). One class declaration, nothing else.
-->

---

# The factory

<CodeFile path="crosshatch/Extension.ts" label="Implementation">

```ts {all|2|3-7|8|9|11-15|17}
export const Service =
  <Self>() =>
  <Id extends string, Identifier extends string, Info extends Extension.Info,
    Enrichment extends Extension.Enrichment<Info>>(
    id: Id,
    definition: { readonly identifier: Identifier; readonly info: Info; readonly enrichment: Enrichment },
  ): Extension<Self, Id, Identifier, Info, Enrichment> => {
    const tag = Context.Service<Self, Service<Enrichment>>()(id)
    const { identifier, info, enrichment } = definition

    const decodeRequired = (required: Required) =>
      S.decodeUnknownEffect(S.toCodecJson(info))(envelopeInfo(required.extensions, identifier))

    const decodePayload = (payload: Payload) =>
      S.decodeUnknownEffect(S.toCodecJson(enrichment))(envelopeInfo(payload.extensions, identifier))

    return Object.assign(tag, { [TypeId]: TypeId, ...definition, decodeRequired, decodePayload })
  }
```

</CodeFile>

<!--
Walk the clicks:
1. Self is supplied explicitly, in its own call. TypeScript can't partially infer type arguments,
   so currying lets Self be explicit while Id, Info and Enrichment are inferred.
2. The real tag is just Context.Service. We aren't reimplementing anything.
3. Derive decoders from the schemas once, here, instead of in every extension.
4. Object.assign makes them statics on the tag, which is itself a class.
-->

---

# The type it returns

<CodeFile path="crosshatch/Extension.ts" label="Interface">

```ts {all|7|8|10-12|14-17}
export interface Extension<
  Self,
  Id extends string,
  Identifier extends string,
  Info extends Extension.Info,
  Enrichment extends Extension.Enrichment<Info>,
> extends Context.Service<Self, Service<Enrichment>> {
  new (_: never): Context.ServiceClass.Shape<Id, Service<Enrichment>>

  readonly identifier: Identifier
  readonly info: Info
  readonly enrichment: Enrichment

  readonly decodeRequired: (required: Required) =>
    Effect.Effect<Info["Type"], S.SchemaError, Info["DecodingServices"]>
  readonly decodePayload: (payload: Payload) =>
    Effect.Effect<Enrichment["Type"], S.SchemaError, Enrichment["DecodingServices"]>
}
```

</CodeFile>

<!--
- extends Context.Service: anywhere a tag is accepted, this is accepted.
- The construct signature is the trick that makes `class X extends Extension.Service<X>()(...)`
  legal: a class can extend any expression whose type has a `new`.
- Everything else is precisely typed metadata, carried from the definition.
-->

---

# Yield it like any service

```ts {1-4|6-8|10-14}
const program = Effect.gen(function* () {
  const enrichment = yield* PaymentId.FromMerchant
  // { readonly required: true; readonly id: PaymentId } | undefined
})

// The extra API travels on the same value
PaymentId.FromMerchant.identifier           // "payment-identifier"
PaymentId.FromMerchant.decodeRequired(required)

// And generic helpers accept any member of the family
export const layerFromPayload = <Self, Id extends string, /* … */>(
  extension: Extension<Self, Id, Identifier, Info, Enrichment>,
  payload: Payload | undefined,
): Layer.Layer<Self, S.SchemaError, /* … */> => Layer.effect(extension, /* decode enrichment */)
```

<!--
Consumers never learn there was a factory. It's a tag, so yield*, Layer.effect, Effect.provide
all just work. And because every extension has the same shape, helpers like layerFromPayload
and layerHandler can be written once for the whole family.
-->

---

# Takeaway

> Wrap `Context.Service` in a curried factory that returns the tag with extra statics, typed with a construct signature.

<p class="drop-cap">You get a parameterised constructor for a whole family of services. Each member is declared as an ordinary class, yielded as an ordinary service, and carries derived, precisely typed behaviour without anyone writing it twice.</p>

---
layout: chapter
chapter: II
accent: gold
---

# Layers as configuration

Swap behaviour by passing values, not names.

---

# A parameterised layer constructor

<CodeFile path="internal-util/layerOtlp.ts" label="Example">

```ts {all|5-6|11-15}
export const layerOtlp = Effect.fn(function* (
  { name: serviceName, version: serviceVersion }: { readonly name: string; readonly version: string },
  attributes?: Record<string, unknown>,
) {
  const stage = yield* ChxStage
  const { url } = yield* ChxDomain
  const options = (v: "logs" | "traces" | "metrics") => ({
    url: `${url}/otel/v1/${v}`,
    resource: { serviceName, serviceVersion, ...(attributes && { attributes }) },
  })
  return Layer.mergeAll(
    OtlpLogger.layer(options("logs")),
    OtlpTracer.layer(options("traces")),
    stage.startsWith("dev_") ? Layer.empty : OtlpMetrics.layer(options("metrics")),
  ).pipe(Layer.provide(OtlpSerialization.layerJson))
}, Layer.unwrap)
```

</CodeFile>

---

# Takeaway

> Use `Effect.fn(…, Layer.unwrap)` when a layer's choice or configuration depends on other services.

<p class="drop-cap">You get a function that returns a <code>Layer</code>, with requirements tracked in its type. No registry, no string-keyed factory. The Layer itself is the extension point.</p>
