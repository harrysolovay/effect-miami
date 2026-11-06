<script setup lang="ts">
defineProps<{ eyebrow?: string; byline?: string }>()
</script>

<template>
  <div class="slidev-layout cover-traits">
    <div class="frame" />
    <div class="inner">
      <p v-if="eyebrow" class="eyebrow">{{ eyebrow }}</p>
      <slot />
      <p v-if="byline" class="eyebrow byline">{{ byline }}</p>
    </div>
  </div>
</template>

<style scoped>
.cover-traits {
  position: relative;
  display: grid;
  place-items: center;
  text-align: center;
  height: 100%;
}

/* Hairline frame that fades out in the middle, like the traits.sh hero. */
.frame {
  position: absolute;
  inset: 1.5rem;
  border: 1px solid color-mix(in srgb, var(--rule) 70%, transparent);
  mask-image: linear-gradient(#000, #0000 28% 72%, #000);
  pointer-events: none;
}

.inner :deep(h1) {
  text-transform: uppercase;
  letter-spacing: 0.045em;
  font-size: 2.75rem;
  line-height: 1.3;
  margin: 1.5rem auto 1.5rem;
  max-width: 44rem;
  text-wrap: balance;
}

.inner :deep(h1 + p),
.inner :deep(p:not(.eyebrow)) {
  font-style: italic;
  font-size: 1.25rem;
  color: var(--ink);
}

.byline {
  margin-top: 2.5rem;
  letter-spacing: 0.08em;
  font-size: 0.75rem;
}
</style>
