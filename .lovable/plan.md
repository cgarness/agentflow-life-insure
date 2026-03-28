

## Dark Mode: True Black Background

Change the dark mode background from dark navy (`222 47% 7%`) to pure black (`0 0% 0%`) for higher contrast.

### Changes in `src/index.css`

In the `.dark` block, update these CSS variables:

- `--background: 222 47% 7%` → `--background: 0 0% 0%`
- `--card: 222 47% 11%` → `--card: 0 0% 5%` (near-black cards for subtle separation)
- `--popover: 222 47% 11%` → `--popover: 0 0% 5%`
- `--sidebar-background: 222 47% 7%` → `--sidebar-background: 0 0% 0%`

All other dark mode variables remain unchanged, preserving the blue accent system and text contrast.

