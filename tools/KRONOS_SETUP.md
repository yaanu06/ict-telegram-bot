# Official Kronos setup

The live adapter uses only the official Tsinghua project [`shiyu-coder/Kronos`](https://github.com/shiyu-coder/Kronos) and the official `Kronos-small` / `Kronos-Tokenizer-base` Hugging Face artifacts.

Model weights and the Hugging Face cache must remain outside this repository. A typical local setup is:

```powershell
git clone https://github.com/shiyu-coder/Kronos C:\Models\Kronos
python -m pip install -r C:\Models\Kronos\requirements.txt
$env:KRONOS_REPO_PATH = 'C:\Models\Kronos'
$env:KRONOS_MODEL_ID = 'NeoQuasar/Kronos-small'
$env:KRONOS_TOKENIZER_ID = 'NeoQuasar/Kronos-Tokenizer-base'
```

The proxy keeps `tools/kronos_worker.py` resident. Local development starts it
lazily on the first forecast request. Render sets `KRONOS_WARMUP=true`, which
starts the worker after Node is listening and loads the model in the
background. If the official package or model is not installed, the worker
returns `KRONOS_STATUS=UNAVAILABLE`; the deterministic ICT scan and manual RAW
workflow continue without fabricated forecast values.

Render builds the same official repository at the pinned revision
`67b630e67f6a18c9e9be918d9b4337c960db1e9a` into `/opt/kronos`; it does not use
the local `.venv-kronos` or a Windows path. The public model and tokenizer use
the normal Hugging Face cache under `HF_HOME`, so no `HF_TOKEN` is required.
