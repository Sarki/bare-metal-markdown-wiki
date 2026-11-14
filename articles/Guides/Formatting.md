---
title: Formatting
tags: howto
---

# Formatting

The three extras on top of standard Markdown: **block containers**,
**alerts** and **tab panels**. Each section shows the syntax, then a
live example.

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
`badgeColors` setting in the block at the top of `index.html` — add
your own words there.

A lone `@` (like in an e-mail address) is left alone — the `{` is what
triggers the badge.

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
