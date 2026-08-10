---
'@agenticschema/core': patch
---

Stop spending tool slots on page chrome.

A CMS puts its own layout in the `@graph`. On an ordinary WordPress article the mapper was handed
seven entities and turned all seven into tools: `get_article`, and then `get_web_page`,
`get_wp_header`, `get_wp_footer`, `get_wp_side_bar` and `list_site_navigation_element`. One of
those answers a question somebody might ask. The rest is the theme describing its own markup, and
each one took a slot out of the twenty-four the content had to fit into. The same page now
produces `get_article` and nothing else.

`mapToTools` already skipped protocol machinery — `EntryPoint` and anything ending in `Action` —
and chrome is now skipped in the same place, by an explicit list of types.

The list has to be explicit, and both shortcuts that suggest themselves are wrong. Reusing
`BOILERPLATE_TYPES` from `select/primary.ts` looks tempting because it carries the same word in
its comment, but it answers a different question: `Organization` and `BreadcrumbList` are poor
guesses at what a page is *about* while still deserving tools of their own. Walking the hierarchy
is no better, because `FAQPage` and `QAPage` are `WebPage` subtypes and are entirely content.

A page with nothing but a wrapper is unaffected: the primary entity is chosen before the filter
and is never subject to it, so markup consisting only of a `WebPage` still yields its one tool.
A node carrying a chrome type alongside a content type counts as content.
