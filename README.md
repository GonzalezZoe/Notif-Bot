# Workana Shopify Bot

Revisa cada 15 minutos los trabajos de **Shopify** publicados en Workana y manda un
email a `zoeeverdeen10@gmail.com` cuando aparece uno nuevo. Reemplaza al viejo bot
de Telegram ([IA-Worki-Bot](https://github.com/GonzalezZoe/IA-Worki-Bot)) que dejó
de funcionar.

## Cómo funciona

- `scripts/check-workana.js` abre `https://www.workana.com/jobs?skills=shopify`
  con un navegador headless (Playwright/Chromium). Workana usa protección
  anti-bot de Cloudflare que bloquea peticiones HTTP simples (`curl`, `fetch`),
  por eso hace falta un navegador real.
- Guarda los IDs de los trabajos ya vistos en `state/seen.json`.
- En cada corrida, compara los trabajos del sitio contra ese archivo. Los que
  no estaban antes se mandan por email (uno o varios juntos) y se agregan al
  archivo.
- La primera corrida solo "siembra" el estado (no manda mail con todo lo que
  ya está publicado) para no spamear con el historial completo.
- `.github/workflows/check-workana.yml` ejecuta el script cada 15 minutos vía
  GitHub Actions (cron) y commitea el `state/seen.json` actualizado al repo.

## Puesta en marcha

### 1. Crear el repositorio en GitHub

Creá un repo (puede ser privado) y subí este código:

```bash
cd workana-shopify-bot
git init
git add .
git commit -m "Bot de notificaciones de Shopify en Workana"
git branch -M main
git remote add origin https://github.com/<tu-usuario>/<nombre-del-repo>.git
git push -u origin main
```

### 2. Generar una contraseña de aplicación de Gmail

El envío usa la cuenta `zoeeverdeen10@gmail.com` (o la que prefieras) por SMTP.
Gmail no permite usar la contraseña normal para esto, hace falta una
"contraseña de aplicación":

1. Activá la verificación en 2 pasos en la cuenta (si no la tenés):
   https://myaccount.google.com/security
2. Andá a https://myaccount.google.com/apppasswords
3. Generá una nueva contraseña de aplicación (nombre libre, ej. "workana-bot").
4. Copiá el código de 16 caracteres que te da — lo vas a necesitar en el
   siguiente paso.

### 3. Configurar los Secrets en GitHub

En el repo: **Settings → Secrets and variables → Actions → New repository secret**.
Agregá estos tres:

| Nombre | Valor |
|---|---|
| `GMAIL_USER` | la cuenta de Gmail que envía, ej. `zoeeverdeen10@gmail.com` |
| `GMAIL_APP_PASSWORD` | la contraseña de aplicación de 16 caracteres del paso 2 |
| `TO_EMAIL` | `zoeeverdeen10@gmail.com` (a dónde llegan las notificaciones) |

Estos valores no deben pegarse en ningún archivo del repo ni pasarse por chat:
se cargan directamente en la interfaz de GitHub.

### 4. Habilitar el workflow

GitHub Actions detecta automáticamente el archivo en `.github/workflows/`. Si
el repo es nuevo puede que tengas que ir a la pestaña **Actions** y confirmar
que los workflows están habilitados.

Para probarlo sin esperar los 15 minutos: pestaña **Actions** → "Check Workana
for Shopify jobs" → **Run workflow**.

## Ajustar qué busca

Editá el array `SEARCHES` en `scripts/check-workana.js` para agregar más
búsquedas (otra skill, otro idioma, etc.). Cada entrada es una URL de listado
de Workana, por ejemplo:

```js
{ label: "Shopify (solo IT)", url: "https://www.workana.com/jobs?category=it-programming&skills=shopify" }
```

## Cambiar la frecuencia

En `.github/workflows/check-workana.yml`, la línea `cron: "*/15 * * * *"`
controla el intervalo (sintaxis cron estándar, en UTC). Por ejemplo, cada 30
minutos: `*/30 * * * *`.

## Probarlo en tu PC (opcional)

```bash
npm install
npx playwright install chromium
$env:GMAIL_USER="..."; $env:GMAIL_APP_PASSWORD="..."; $env:TO_EMAIL="..."
npm run check
```

(La primera vez no manda mail, solo guarda el estado inicial — borrá
`state/seen.json` y corré de nuevo si querés forzar una segunda corrida que sí
detecte "trabajos nuevos".)

## Notas

- Si Workana cambia el HTML de la página, el scraper puede dejar de encontrar
  trabajos. En ese caso el script falla explícitamente (`No se encontró
  ningún trabajo...`) y la corrida en GitHub Actions queda marcada en rojo en
  la pestaña Actions — es la señal de que hay que revisar los selectores en
  `scripts/check-workana.js`.
- El estado se poda automáticamente: entradas de más de 30 días se eliminan
  de `state/seen.json` para que no crezca sin límite.
