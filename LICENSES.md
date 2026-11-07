# Third-party licenses

Vitra's own code is under the MIT License (see `LICENSE`). It uses or bundles the following.

| Component | How it's used | License |
|---|---|---|
| Llama 3.2 3B Instruct (Meta), Q4_K_M GGUF | The local model. Weights are **not** in this repository; download them separately | Llama 3.2 Community License. Built with Llama |
| llama.cpp (`llama-server`) | Runs the model on `127.0.0.1` | MIT |
| Geist, Geist Mono (Vercel) | Bundled in `web/public/fonts/` | SIL Open Font License 1.1, see `web/public/fonts/OFL-geist.txt` |
| Instrument Serif (Instrument) | Bundled in `web/public/fonts/` | SIL Open Font License 1.1, see `web/public/fonts/OFL-instrument-serif.txt` |
| React, three.js, @react-three/fiber, @react-three/drei, zustand, Vite, Tailwind CSS | Frontend dependencies, installed from npm | MIT |
| FastAPI, Pydantic, Uvicorn, httpx | Backend dependencies, installed from PyPI | MIT / BSD-3-Clause |

The HACK1984 organizer dataset is not included. It was provided for the hackathon only.
