<script setup lang="ts">
// Wraps a fenced code block with a file-path heading, like traits.sh's .code-heading.
defineProps<{ path: string; label?: string }>()
</script>

<template>
  <figure class="code-file">
    <figcaption>
      <span class="path">{{ path }}</span>
      <span v-if="label" class="label">{{ label }}</span>
    </figcaption>
    <slot />
  </figure>
</template>

<style scoped>
.code-file {
  margin: 0;
  border: 1px solid var(--rule-strong);
  background: var(--paper-code);
  box-shadow: 3px 3px 0 color-mix(in srgb, var(--rule) 35%, transparent);
}

figcaption {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  padding: 0.55rem 1rem;
  border-bottom: 1px solid var(--rule-strong);
  font-family: var(--mono);
  font-size: 0.65rem;
  color: var(--muted);
}

.label {
  font-family: var(--serif);
  text-transform: uppercase;
  letter-spacing: 0.2em;
  font-size: 0.55rem;
  color: var(--gold);
}

/* The inner block drops its own frame since the figure provides one. */
.code-file :deep(pre.slidev-code) {
  border: 0;
  box-shadow: none;
  margin: 0;
}
</style>
