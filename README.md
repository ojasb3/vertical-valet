# Vertical Valet

A free browser game: drive a rocket-thruster sports car up the walls of a night city and park it in a garage bay
on the side of a skyscraper. Plays on phones (touch) and desktops (keyboard).

- `index.html`: landing page (trailer slot, Play button, how to play, credits)
- `play/`: the game (static three.js app, no build step)
- `media/`: page images and the launch trailer (`trailer.mp4`, 720x1280 web encode)

## Run locally

Any static file server, from this folder:

```bash
npx serve .
```

(Opening `index.html` from disk won't run the game: browsers block JavaScript modules on `file://`.)

## Publish on GitHub Pages (Oz approves this step)

1. Create an empty public repository on GitHub.
2. `git remote add origin <repo-url>` then `git push -u origin main`
3. Repository Settings → Pages → Source: *Deploy from a branch*, Branch: `main`, folder `/ (root)`.

Every path is relative, so the site works at `https://<user>.github.io/<repo>/` or on a custom domain.
`.nojekyll` makes Pages serve the files as they are.

## Credits

Built by Claude (Anthropic): game code, levels, physics, sound effects, the car model (Blender) and this page.
Idea and direction: Oz. Uses [three.js](https://threejs.org/) r170 (MIT licence, see `play/vendor/three/LICENSE`).
No real-world car brands, badges or logos are used.
