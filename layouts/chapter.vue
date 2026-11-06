<script setup lang="ts">
withDefaults(defineProps<{ chapter?: string; accent?: "blue" | "gold" | "green" | "coral" | "plum" }>(), {
  accent: "blue",
})
</script>

<template>
  <div class="slidev-layout chapter-traits" :style="{ '--accent': `var(--${accent})` }">
    <p v-if="chapter" class="eyebrow chapter-label">Chapter {{ chapter }}</p>
    <div class="rule" />
    <slot />
  </div>
</template>

<style scoped>
.chapter-traits {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
  height: 100%;
}

.chapter-label {
  color: var(--accent);
  letter-spacing: 0.2em;
}

.rule {
  width: 3rem;
  height: 1px;
  background: var(--accent);
  margin: 1rem 0 0.5rem;
}

.chapter-traits :deep(h1) {
  font-size: 3.25rem;
  margin: 0.75rem 0 1rem;
}

.chapter-traits :deep(p:not(.eyebrow)) {
  max-width: 36rem;
  color: var(--muted);
}
</style>
