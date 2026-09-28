---
name: Python tooling in Node projects
description: Package-manager side effects when using Python only to inspect an uploaded PDF.
---

Installing a temporary Python inspection package in this Node project can create Python starter files and add Nix packages to the Replit project configuration.

**Why:** The inspection package was needed only to view a supplied PDF, but installation also changed unrelated project files and the workspace config.

**How to apply:** After one-off PDF inspection, inspect the working-tree diff and remove only inspection-generated files. Restore incidental Replit config through its validated configuration replacement mechanism rather than leaving those changes in the app.