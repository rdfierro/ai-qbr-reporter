# Repository Guidelines

## Project Structure & Module Organization
- `lib/` holds the AWS CDK stacks (data lake, analytics, Bedrock, Step Functions, email, app shell); treat each file as the authority for its stack.
- `bin/ai-qbr-reporter.ts` composes stacks and environment wiring; keep overrides here rather than in stack classes.
- `app/` provides Python 3.11 Lambda code plus shared utilities and prompts, with tests under `app/tests`.
- `layers/python311/` packages Lambda dependencies; update `requirements.txt` and rerun `make init` after adding libraries.
- `infra/parameters.example.json` is the template for deploy settings; copy to `infra/parameters.json` for local work and source secrets from AWS stores.

## Build, Test, and Development Commands
- `make init` installs Node/CDK modules and the Python layer requirements.
- `make build` (or `npm run build`) compiles TypeScript to `dist/`; run before synth or deployment.
- `make test` executes the pytest suite in `app/tests/unit`; add `pytest -k name` for focused runs.
- `npm run lint` applies ESLint + Prettier to CDK sources; resolve findings prior to commits.
- `make deploy` performs `cdk synth` and `cdk deploy --all`; limit to sandbox accounts and document manual steps.

## Coding Style & Naming Conventions
- TypeScript uses 2-space indentation, single quotes, `camelCase` for functions, and `PascalCase` constructs; stay `strict` compliant per `tsconfig.json`.
- Python uses 4-space indentation, type hints, and `snake_case`; reuse data models in `app/lambdas/common` before introducing new ones.
- Run `npm run lint` before PRs and keep shared Lambda environment settings within `baseLambdaEnv` in `lib/app-stack.ts`.

## Testing Guidelines
- Cover new logic with unit tests in `app/tests/unit/test_*.py`; mirror module names so fixtures stay discoverable.
- Install test dependencies via `pip install -r app/tests/requirements-test.txt` and run `pytest` locally.
- Prefer fixtures in `app/tests/fixtures` for AWS client stubs and KPI payloads, and add Step Functions contract tests when state inputs change.

## Commit & Pull Request Guidelines
- Use Conventional Commit prefixes (`feat:`, `fix:`, `chore:`) as shown in `chore: create stack markdown`.
- Keep commits focused and document infrastructure or schema implications in the message body.
- PRs should summarize problem and solution, list local checks (`make test`, `npm run build`), link issues, and update `STACK.md` or `docs/` when architecture shifts.

## Configuration & Security Notes
- Never commit `infra/parameters.json`, Bedrock model IDs, or webhook URLs; the template is gitignored for this reason.
- Store secrets in SSM or Secrets Manager and reference them via CDK parameters; confirm SES and Bedrock access before promoting changes.
