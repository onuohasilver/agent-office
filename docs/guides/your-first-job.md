# Your first job

Ten minutes from a fresh install to a change you've reviewed. This assumes
the office is running — if not, start with [Getting started](../getting-started.md).

## 1. Pick something small

The first job should be easy to check by eye: fix a typo, add a test case,
rename something, tidy a README. You'll learn how the office works without
wondering whether the agent got something subtle right.

## 2. Check the pickers under the composer

- **Clearance** — leave it on **Edit files**. The agent can read and change
  files but not run commands, which is the right amount of trust for a first
  job. ([What each one allows](../jobs.md#clearance).)
- **Model** — leave it on **Chief picks**. A small job will go to Haiku or
  Sonnet.

## 3. Ask

In `#general`, tag a project with `#` and say what you want, as you'd say it
to a colleague:

```
#storefront the checkout button says "Procede" — fix the spelling
```

You can tag someone with `@` too (`@Ada #storefront …`). Without a tag, the
chief of staff picks whoever is free and replies with who and why.

## 4. Watch

The agent gets up and goes to work. Where they walk tells you what they're
doing: the **library** to read code, their **desk** to write, the **server
room** to run commands, the **whiteboard** to plan. Their updates collect in a
thread under your message; open it, or click the agent, to follow along.

## 5. Review what changed

When they're done, the result lands in the chat with a chime. Open the job
(the **Jobs** tab, or the link in the reply) and look at **What changed**:
every file the job touched, with lines added and removed. Click a file to see
its patch.

The change is in your working tree, not committed. Review it the way you
would any change — `git diff`, your editor, your tests — and commit it
yourself when you're happy.

## 6. Follow up

Not quite right? Reply in the job's thread: *"also fix it on the receipt
page"*. The same agent picks it up in the same session, with everything they
learned the first time. If the chief chose the model and the work was wrong,
saying so sends it back one model up.

If the agent got **blocked** — it tried to run a command its clearance
doesn't allow — the job's drawer shows what was refused, with a button to
grant more and carry on.

## Next

- [Working with the team](working-with-the-team.md) — briefs that work,
  channels, and keeping costs down.
- [Jobs](../jobs.md) — clearance, models and what changed in detail.
