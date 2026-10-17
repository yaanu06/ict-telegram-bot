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

The proxy starts `tools/kronos_worker.py` on the first forecast request and keeps it resident. If the official package or model is not installed, the worker returns `KRONOS_STATUS=UNAVAILABLE`; the deterministic ICT scan and manual RAW workflow continue without fabricated forecast values.
