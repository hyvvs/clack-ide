# AI Runtime Controls

Clack keeps agent execution in the central chat, session, permission, approval,
and todo stores. `AiMiniWindow` is a view over that state. Closing, minimizing,
or unmounting the transcript does not stop a run or resolve an approval.

## Agent permission profiles

Permission profiles are keyed by the stable agent persona ID, such as
`builtin:coder`. Provider and model selection are not security identities.

- **Chat Only** blocks every Clack tool before its implementation executes.
- **Ask** keeps the default policy: safe read-only tools run, while the current
  mutation categories request approval.
- **Trusted Workspace** automatically allows grantable routine mutations inside
  the active workspace. Strict and outside-workspace actions still ask.
- **Full Access** removes Clack approval prompts for exposed tools. It does not
  bypass secret-path guards, workspace authorization, Tauri capabilities,
  operating-system permissions, or process privilege boundaries.
- **Custom** automatically allows enabled categories inside the active workspace
  and asks for disabled categories.

Effective authorization uses this precedence:

1. Application, Tauri, operating-system, and tool security restrictions, which
   are always enforced by the tool implementation
2. Chat Only denial
3. Full Access automatic approval
4. Strict-action prompting for every other profile
5. Existing chat and workspace grants
6. Trusted Workspace or Custom category allowances
7. The default Ask policy

Strict actions remain non-inheritable in Ask, Trusted Workspace, and Custom.
Full Access deliberately skips the Clack prompt, but the tool implementation's
security checks still run.

Chat grants are keyed by session and agent. Workspace grants are keyed by
workspace environment, canonical workspace path, and agent. Agent profiles are
persisted through the shared preferences store and are edited by both the chat
header control and Settings.

## Autonomous run budgets

Tool authorization and autonomous run length are separate policies. Permission
profiles decide whether a tool may execute. The run budget decides whether the
same logical run may cross another internal SDK step boundary without a user
gesture.

Each SDK generation has a 24-step soft boundary. Ask, Chat Only, and Custom
pause at that boundary and show the ordinary Continue action. Trusted Workspace
and Full Access automatically resubmit the existing assistant message, keeping
the same Chat instance, session, run start time, agent, model, transcript,
approval state, todos, and cancellation path. The resubmission does not add a
synthetic user message or start another logical run.

Automatic continuation is bounded to 240 total steps and 9 automatic
continuations per authorization window. Three consecutive identical failing
tool calls with identical arguments and results also stop automatic execution.
Calls with changing results do not count as the same failure loop. At a hard
boundary Clack shows `Autonomous run limit reached` with the actual totals. The
user can explicitly continue anyway, which grants another bounded window rather
than enabling unlimited execution.

Provider failures, network errors, rate limits, explicit Stop, tool and platform
security failures, and terminal run states never turn into automatic
continuations. Changing a running agent from Trusted Workspace or Full Access to
a conservative profile takes effect at the next soft boundary.

## Window and run lifecycle

Minimize changes only `mini.open` and `mini.minimized`. The session, Chat
instance, run state, provider/model selection, cancellation path, pending
approval records, and active todos remain in central state.

When an approval arrives while minimized, Clack keeps the window minimized and
changes the AI status affordance to `Approval required`. Restoring the window
shows the exact approval from the same session.

Completed, cancelled, interrupted, and failed runs finalize unfinished todos
and remove the active todo list from memory and persistence. Tool and message
history remains in the transcript. Startup recovery converts stale running
sessions to interrupted and clears their active todos before the transcript can
render them.
