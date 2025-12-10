# Vampanchino Birthday Tag

- Lightweight HTML5 + Node/WebSocket mini-game set in the grid streets of Sant Antoni.
- Vampanchino chases three runners; runners survive until midnight (20:00 → 24:00, 1 minute per real second) or collect every item.
- An orange cat zooms quickly and sometimes naps for about a minute.

## Folders
- `frontend/`: static client (HTML5 canvas + vanilla JS)
- `server/`: Node.js WebSocket server

## Quick start (local)
```bash
# install server deps
cd server
npm install
npm start    # defaults to ws://localhost:3000
```

Open `frontend/index.html` in your browser (or serve the folder), leave the default server URL, enter a room code (e.g. SANT20), pick a role, and share the same code with friends.

## Hosting
- Frontend: push `frontend/` to GitHub Pages/Netlify/Vercel as static files.
- Server: deploy `server/` to a free-tier host with Node WebSocket support (Render, Railway, Fly.io, etc.). Expose the port via `PORT` env.
- Configure the frontend to point at your hosted server:
  ```html
  <!-- add before game.js -->
  <script>window.GAME_SERVER="wss://your-app.onrender.com";</script>
  ```

## Controls & Rules
- Move: WASD or arrow keys.
- Vampanchino wins by tagging all runners before midnight.
- Runners win by reaching midnight or collecting all items.
- Orange cat moves fast, occasionally stopping for ~60s.

## Notes
- Assets are placeholders; drop in your 2D art by replacing the simple shapes drawn in `frontend/game.js`.
- Each room uses its code (4–6 chars). Share the same code with friends to play together.