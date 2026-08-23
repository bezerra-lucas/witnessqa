# WitnessQA Run — 2026-08-23T04:50:49.237Z

**Veredito geral:** 🔴 1/8 com problema

## ✅ cliente-login — pass
- ok step 0: `{"goto":"https://cliente.async.dev.br/"}` (evidência: step-00.png)
- ok step 1: `{"fill":{"selector":"input[type=email], input[name=email]","value":"cliente.demo.evovision@async.dev.br"}}` (evidência: step-01.png)
- ok step 2: `{"fill":{"selector":"input[type=password], input[name=password]","value":"17133324008"}}` (evidência: step-02.png)
- ok step 3: `{"click":"button[type=submit]"}` (evidência: step-03.png)
- ok step 4: `{"wait":4000}` (evidência: step-04.png)
- ok step 5: `{"expectVisible":"body"}` (evidência: step-05.png)

## ✅ regressao-home-1 — pass
- ok step 0: `{"goto":"https://cliente.async.dev.br"}` (evidência: step-00.png)
- ok step 1: `{"wait":1500}` (evidência: step-01.png)
- ok step 2: `{"expectVisible":"body"}` (evidência: step-02.png)

## ✅ regressao-projects-2 — pass
- ok step 0: `{"goto":"https://cliente.async.dev.br/projects"}` (evidência: step-00.png)
- ok step 1: `{"wait":1500}` (evidência: step-01.png)
- ok step 2: `{"expectVisible":"body"}` (evidência: step-02.png)

## ✅ regressao-projects-8e056209-0f25-4491-8b4f-30d850bcc6cc-feedback-3 — pass
- ok step 0: `{"goto":"https://cliente.async.dev.br/projects/8e056209-0f25-4491-8b4f-30d850bcc6cc/feedback"}` (evidência: step-00.png)
- ok step 1: `{"wait":1500}` (evidência: step-01.png)
- ok step 2: `{"expectVisible":"body"}` (evidência: step-02.png)

## ✅ regressao-projects-8e056209-0f25-4491-8b4f-30d850bcc6cc-units-4 — pass
- ok step 0: `{"goto":"https://cliente.async.dev.br/projects/8e056209-0f25-4491-8b4f-30d850bcc6cc/units/ab5c070b-d2f1-4302-b8f6-666ebecd361e/intro"}` (evidência: step-00.png)
- ok step 1: `{"wait":1500}` (evidência: step-01.png)
- ok step 2: `{"expectVisible":"body"}` (evidência: step-02.png)

## ✅ regressao-projects-8e056209-0f25-4491-8b4f-30d850bcc6cc-units-5 — pass
- ok step 0: `{"goto":"https://cliente.async.dev.br/projects/8e056209-0f25-4491-8b4f-30d850bcc6cc/units/ab5c070b-d2f1-4302-b8f6-666ebecd361e/checkout"}` (evidência: step-00.png)
- ok step 1: `{"wait":1500}` (evidência: step-01.png)
- ok step 2: `{"expectVisible":"body"}` (evidência: step-02.png)

## ✅ regressao-projects-8e056209-0f25-4491-8b4f-30d850bcc6cc-units-6 — pass
- ok step 0: `{"goto":"https://cliente.async.dev.br/projects/8e056209-0f25-4491-8b4f-30d850bcc6cc/units"}` (evidência: step-00.png)
- ok step 1: `{"wait":1500}` (evidência: step-01.png)
- ok step 2: `{"expectVisible":"body"}` (evidência: step-02.png)

## ❌ smoke-home — fail
- FALHOU step 0: `{"goto":"/"}` — Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL (evidência: step-00.png)

