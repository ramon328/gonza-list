# Lista de compras familiar

App web simple (HTML + CSS + JS, sin dependencias ni build) para armar una lista de compras por cada integrante de la familia.

- **Editar**: agrega integrantes, elige sus productos por categoría, agrega productos o categorías nuevas.
- **Datos locales**: todo se guarda en el navegador (`localStorage`) y no se pierde al recargar o cerrar la pestaña.
- **Compartir**: envía la lista por WhatsApp, cópiala como texto o copia un enlace que permite guardarla en otro teléfono.
- **Todos**: vista combinada con lo que necesita toda la familia.

## Usar

Abre `index.html` o sírvela como sitio estático:

```sh
python3 -m http.server 8000
```

## Publicar en Vercel

El proyecto ya incluye `vercel.json` (sitio estático, sin build, cabeceras de seguridad y sin caché para que los cambios se vean al tiro) y `.vercelignore`.

**Opción A — desde GitHub (recomendada):**
1. Sube el repo a GitHub.
2. En [vercel.com/new](https://vercel.com/new) importa el repo. No hay que configurar nada: Framework "Other", sin build command.
3. Cada `git push` a `main` publica una nueva versión.

**Opción B — desde la terminal:**

```sh
npm i -g vercel   # si no lo tienes
vercel login
vercel            # primera vez: crea el proyecto y publica una preview
vercel --prod     # publica en producción
```

> Cada teléfono guarda sus propios datos. Usa el botón **Compartir → Copiar enlace** para pasar listas entre teléfonos.
