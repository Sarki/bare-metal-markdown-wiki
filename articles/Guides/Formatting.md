---
title: Formatting
tags: howto
---

# Formatting

The extras on top of standard Markdown: **block containers**,
**alerts**, **tab panels** and **foldable sections**. Each section shows
the syntax, then a live example.

## Block containers

Anything between a named opening line and a closing line becomes a box.
The name becomes a CSS class, so any name works:

````markdown
::: note
Boxed text. Any Markdown works inside.
:::
````

::: note
Boxed text. Any Markdown works inside — lists, code, even nested containers.
:::

A container named `foo` is closed by a bare `:::` or by `::: foo`.
An unclosed container runs to the end of the file.

## Alerts

A blockquote whose first line is `[!TYPE]` becomes a callout.
Five types: `note`, `tip`, `important`, `warning`, `caution`
(case-insensitive). Text after the marker becomes a custom title:

````markdown
> [!WARNING] Rebuild first
> `data.js` is overwritten on every build.
````

> [!WARNING] Rebuild first
> `data.js` is overwritten on every build.

A plain blockquote (no `[!TYPE]` marker) stays a plain quote:

> Just a quote, nothing special.

## Tab panels

A `tabs` container holding `tab: Name` containers becomes a button bar
with one pane per tab. The first tab is active by default; clicking a
button switches panes. The name is the button label, so anything works:

````markdown
::: tabs
::: tab: JavaScript
```js
console.log('tabbed');
```
:::
::: tab: Python
```python
print('tabbed')
```
:::
:::
````

::: tabs
::: tab: JavaScript
```js
console.log('tabbed');
```
:::
::: tab: Python
```python
print('tabbed')
```
:::
:::

## Foldable sections

A `fold` container collapses its content behind a clickable title —
click to open, click to close. `fold!` starts open; no title uses the
browser's default label. It's a native disclosure, so keyboard and
screen readers work for free:

````markdown
::: fold Implementation notes
Anything renders inside — even this fenced code block:
```js
console.log('hidden until opened');
```
:::
````

::: fold Implementation notes
Anything renders inside — even this fenced code block:
```js
console.log('hidden until opened');
```
:::

Folds nest, and the title takes inline markdown (badges, bold, …).
Printing opens every fold automatically, so nothing stays hidden on
paper — turn that off with `expandOnPrint: false` in `config.js`.

## Inline badges

Wrap `@{ name }` to render a small pill — handy for statuses, versions,
or any short label inside a sentence:

```markdown
This page is @{draft} and the plugin is @{v1.0} stable.
```

This page is @{draft} and the plugin is @{v1.0} stable.

Known status words get a color — the first word decides:

@{draft} @{wip} @{review} · @{stable} @{done} @{passed} · @{error} @{broken} @{deprecated} · @{new} @{beta} · @{alpha} @{planned}

Anything else stays the neutral gray pill. The word list is the
`badgeColors` setting in `config.js` — add your own words there.

A lone `@` (like in an e-mail address) is left alone — the `{` is what
triggers the badge.

## Button links

Prefix any link with `@` and it renders as a button — handy for "get
started" or next-page calls to action inside an article:

```markdown
@[back to basics](Basics.md) @[[Advanced|try diagrams and math]]
```

@[back to basics](Basics.md) @[[Advanced|try diagrams and math]]

Targets work exactly like any other link: relative paths, `[[wiki
links]]` (the `@` just goes before the `[[`), external URLs, local
`.html` files. The label keeps inline markdown (bold, badges, …). The
`@` must sit directly against the link — a space between (`me @ [x](u)`)
or a backslash (`me\@[x](u)`) keeps a plain link.

An optional `{color}` suffix right after the link picks the fill color
— same palette as the badges: `{green}`, `{yellow}`, `{red}`, `{blue}`
(the default), `{purple}`:

@[a green one](Basics.md){green} @[[Advanced|and a red one]]{red}

Unknown names are not swallowed: they stay as literal text right after
the button, so a typo shows up on the page instead of being silently
ignored.

Want other colors? The classes are `btn--green` … on `#page a` — restyle
them (or add your own) in `user.css`.

## Links that open a new tab

External links — `https://…` and `mailto:…`, written or bare — open in
a new tab automatically, so the wiki stays where you left it.

A wiki page is a plain URL: the `#…` part of the address bar loads that
page directly, so copy it to open the page in another tab or share it.

## Things that stay normal

- A paragraph that merely mentions `:::` is not a container — the marker
  must start the line.
- A `::: tabs` group with no `tab:` children renders as a plain box.
- Nesting works at any depth: containers inside containers, containers
  inside panes. (Tabs inside tabs work too — just don't.)

Next: [[Basics]].
