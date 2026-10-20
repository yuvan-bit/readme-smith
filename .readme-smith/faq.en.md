### How is this different from similar tools?
Most generators hand you a skeleton full of placeholder prose and a single language. Every badge, diagram and command here is derived from a fact the scanner actually found in your repository, and a claim it cannot verify is left out rather than guessed at. The output is two files in the same shape, so the English and the Simplified Chinese README cannot drift apart.

### How do I keep the README from falling behind the code?
Put `readme-smith generate --check` in CI with the same options you generate with. It renders the documents, compares them with the files on disk and exits non-zero on the first line where they stop agreeing, without writing anything. `generate` itself now re-renders until the document describes the files it just wrote, so the file it leaves behind passes the check immediately.

### Why would `--check` fail on a checkout with `core.autocrlf=true`?
The document reports the repository's size in bytes, and the same commit checked out with CRLF really is bigger. Pin line endings once with a `.gitattributes` (`* text=auto eol=lf`) and every machine agrees. The README's own line endings are never counted as drift.

### Is this production ready?
The translation provider layer, the Markdown list renderer and the `generate`/`--check` round trip have regression tests, the last of them by running the compiled CLI against temporary repositories. The command-line detector is tested as well; most of the scanner's other heuristics are not, so an unusual project layout can still be misread. Treat the output as a well-structured first draft: review it, replace the prompts it marks for you, then commit. Registry and CI claims need `--unpublished` or a real remote to be truthful, and the package itself is not published yet, so install it from source.
