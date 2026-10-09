# XVP Copilot Instructions

## OpenSpec Implementation Rules (`/opsx:apply`)

When implementing tasks via `/opsx:apply`:

**Role**: Peer with user as senior engineer; execute disciplined implementation with user oversight.

**Verification**: Bark like a dog before starting each section.

**Halt Conditions**:
- STOP after completing each numbered section (## N.) and wait for user approval before continuing to the next section
- STOP if approaching ~100 LOC and wait for user guidance to either proceed or break remaining tasks into a follow-up section
- STOP if implementation reveals a problem with the test contract: explain why the contract needs to change and ask the user how to proceed (tests are written first and should not be modified during implementation unless there is a contract issue)
- STOP if implementation reveals a problem with the design: explain what part of the design is in question and ask the user how to proceed (design or spec changes require engaging with OpenSpec)
