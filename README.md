# Powerline status

A powerline-style status row around the prompt, in the style of Powerlevel10k.

## Segments

| Segment | Shows |
|---|---|
| model | The session's model, short name. |
| thinking | The reasoning effort, colored by level. |
| path | The project folder (`basename`) or an abbreviated path. |
| git | Branch, staged (`+`), unstaged (`*`), and untracked (`?`) counts. Green when clean. |
| context | Context window usage; yellow above 70%, red above 90%. |
| tokens | Input, output, and cache-read tokens this session. |
| host, time | Host name and the time, in the fuller presets. |

Git status is cached for a second and refreshed after the agent edits files or runs commands.

## Presets

| Preset | Segments |
|---|---|
| `default` | model, thinking, path, git, context, cache reads |
| `minimal` | path, git, context |
| `compact` | model, git, context |
| `full` | host, model, thinking, path, git · tokens in/out, cache, context, time |
| `nerd` | like `full`, with a longer path |
| `ascii` | model, path, git · total tokens, context |

Nerd Font glyphs are used in iTerm, WezTerm, kitty, Ghostty, and Alacritty; other terminals get
ASCII. `POWERLINE_NERD_FONTS=1` or `=0` forces either.

## Commands

- `/powerline <preset>` switches preset.
- `/powerline on|off` shows or hides the row (no argument toggles it).
- `/powerline placement above|below|toggle` moves the row above or below the prompt.

The choices are saved across sessions.

## Install

```bash
cmd mods add ./mods/powerline-status
```

## Not covered

- **Cost** is not shown: per-request cost is not exposed to mods.
- **Editor features** are not ported: the editor stash, delayed send, the post-compaction message
  queue, themed loading messages, the welcome overlay, sticky bash mode, and shell suggestions.
  They change how the prompt itself works, which mods cannot do.
- **Custom segments** from other mods' status keys: Command Code already shows every mod's status
  segment in the footer row.
