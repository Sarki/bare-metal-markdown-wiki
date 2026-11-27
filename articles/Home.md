---
title: Home
tags: meta, getting-started
---

# Home


Welcome to your local wiki. This whole thing is **offline**: a static HTML frame
([`index.html`](index.html)) that reads markdown and renders it in the browser. No server,
no internet after the build.

## Start here

- [[Basics]] — how it all works
- [[Formatting]] — containers, alerts and tab panels
- [[Advanced|the deep end]] — diagrams and math
- The file behind Basics is [`Guides/Basics.md`](Guides/Basics.md) (a relative `.md` link).

## Math works inline and display

Inline: $E = mc^2$ and $a^2 + b^2 = c^2$.

$$\int_0^\infty e^{-x^2}\,dx = \frac{\sqrt{\pi}}{2}$$

## Code is highlighted

```python
def fib(n):
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a
```

A footnote demo: this claim has a source.[^note1]

[^note1]: Footnotes are written at the bottom of the file as `[^id]: text`.

## A broken wiki link looks like this

[[ThisPageDoesNotExist]]
