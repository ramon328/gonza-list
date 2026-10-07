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

Para usarla desde varios teléfonos, publícala en cualquier hosting estático (Vercel, Netlify, GitHub Pages).
