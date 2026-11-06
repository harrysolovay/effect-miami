import { defineShikiSetup } from "@slidev/types"

// Syntax themes built from the traits.sh palette.
const palette = {
  light: {
    bg: "#f5edd3",
    fg: "#292e29",
    muted: "#8e8775",
    coral: "#b3644b",
    blue: "#506d75",
    gold: "#9c7b30",
    green: "#66744f",
    plum: "#806181",
  },
  dark: {
    bg: "#352a39",
    fg: "#ece0cf",
    muted: "#9a8a94",
    coral: "#d99a90",
    blue: "#a6afc7",
    gold: "#cbb078",
    green: "#adb392",
    plum: "#c5a3c4",
  },
}

const theme = (type: "light" | "dark") => {
  const c = palette[type]
  return {
    name: `traits-${type}`,
    type,
    colors: {
      "editor.background": c.bg,
      "editor.foreground": c.fg,
    },
    tokenColors: [
      { settings: { foreground: c.fg, background: c.bg } },
      { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: c.muted, fontStyle: "italic" } },
      { scope: ["keyword", "storage", "storage.type", "storage.modifier", "keyword.operator.new", "keyword.control"], settings: { foreground: c.plum } },
      { scope: ["string", "string.template", "punctuation.definition.string"], settings: { foreground: c.green } },
      { scope: ["constant.numeric", "constant.language", "constant.character", "support.constant"], settings: { foreground: c.coral } },
      { scope: ["entity.name.function", "support.function", "meta.function-call entity.name.function"], settings: { foreground: c.blue } },
      { scope: ["entity.name.type", "entity.name.class", "support.type", "support.class", "entity.other.inherited-class", "meta.type.annotation entity.name.type"], settings: { foreground: c.gold } },
      { scope: ["variable.parameter"], settings: { foreground: c.fg, fontStyle: "italic" } },
      { scope: ["variable.other.property", "meta.object-literal.key", "support.variable.property"], settings: { foreground: c.fg } },
      { scope: ["punctuation", "meta.brace", "keyword.operator"], settings: { foreground: c.muted } },
      { scope: ["markup.inserted", "punctuation.definition.inserted"], settings: { foreground: c.green } },
      { scope: ["markup.deleted", "punctuation.definition.deleted"], settings: { foreground: c.coral } },
      { scope: ["entity.name.tag"], settings: { foreground: c.plum } },
      { scope: ["entity.other.attribute-name"], settings: { foreground: c.gold } },
    ],
  }
}

export default defineShikiSetup(() => ({
  themes: {
    light: theme("light"),
    dark: theme("dark"),
  },
}))
