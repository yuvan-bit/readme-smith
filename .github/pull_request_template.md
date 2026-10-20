## Summary

<!-- What changes, and why? Link the issue if one exists. -->

## Checklist

- [ ] `npm run typecheck` passes
- [ ] `npm run build` passes
- [ ] `npm test` passes
- [ ] `node dist/cli.js doctor . --min-score 85` passes
- [ ] `node dist/cli.js check . --min-score 85` passes
- [ ] New facts are proven by the repository; nothing is inferred or guessed
- [ ] No secrets, tokens, `.env` files or generated `dist/` output are included
- [ ] Golden fixtures were regenerated intentionally (`UPDATE_GOLDEN=1`) if fact output changed

## Test plan

<!-- Commands you ran and what you observed. Include `rf diff --show` output when templates changed. -->

## Screenshots

<!-- Only if the change is visible in a terminal; avoid screenshots containing secrets. -->
