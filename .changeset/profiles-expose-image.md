---
'@agenticschema/profiles': patch
---

Expose `image` on the profiles that describe something you would want to look at, and `logo` on
`Organization`.

No profile picked or followed `image`, so it was dropped from every tool the registry produced. An
agent asked about a product, a recipe or a film got the name, the price and the description, and no
way to show any of it. `image` sits in the 10M+ domains bucket of the usage statistics schema.org
publishes from Google's crawl — after `name` and `url` it is about the most widely published
property there is, and this library was throwing all of it away.

It also cost a tool slot. An `image` given as one or more `ImageObject` entities was left
unconsumed, so those entities fell through to the grouping pass and became a `list_media` tool of
their own: the same pictures, detached from the article they belong to, one of the twenty-four
slots gone. Picked, they render inline where they belong and the slot goes back to the budget.

Affected profiles: `product`, `article`, `recipe`, `event`, `movie`, `book`, `business`, `person`,
`organization`, `application`, `course`, `property`. `media` already carried `contentUrl` and
`thumbnailUrl`, and profiles like `offer`, `rating` and `job` describe things that have no picture
of their own.

Released as a patch, since it restores a property that should never have been dropped. What tools
return does change all the same, and it is worth knowing about: existing tools gain a field, and a
page whose only extra entities were images no longer produces `list_media`.
