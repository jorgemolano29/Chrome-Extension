# VisasPro DS-160 AutoFill — Chrome Extension (POC v1.0)

## ¿Qué hace esta extensión?

1. **Carga el PDF** de información del cliente (formato VisasPro)
2. **Extrae automáticamente** todos los datos del formulario rellenable
3. **Almacena los datos** temporalmente en el browser
4. **Llena el DS-160** sección por sección con un clic

---

## Instalación (modo desarrollador)

1. Abre Chrome y ve a `chrome://extensions/`
2. Activa **"Modo desarrollador"** (toggle arriba a la derecha)
3. Haz clic en **"Cargar descomprimida"**
4. Selecciona la carpeta `visaspro-extension`
5. La extensión aparecerá en tu barra de herramientas

---

## Uso

### Paso 1: Cargar el PDF
- Abre la extensión haciendo clic en el ícono VP
- Arrastra el PDF del cliente o haz clic para seleccionarlo
- La extensión extrae los datos automáticamente

### Paso 2: Llenar el DS-160
- Abre `https://ceac.state.gov/genniv/` en tu navegador
- Ingresa los datos de sesión del cliente como de costumbre
- Navega a la primera sección del formulario
- En la extensión, haz clic en el botón de la sección correspondiente
- Revisa visualmente los campos llenados
- Continúa con la siguiente sección

---

## Secciones disponibles

| Botón | Sección DS-160 | Estado |
|-------|----------------|--------|
| Personal Info 1 | Apellidos, nombre, género, nacimiento, nacionalidad | ✅ POC |
| Personal Info 2 | CURP, otras nacionalidades | ✅ POC |
| Travel | Fecha viaje, duración, dirección US | ✅ POC |
| Travel Companions | Acompañantes | 🔄 Próxima versión |
| Prev. US Travel | Viajes previos, visa anterior | 🔄 Próxima versión |
| Address & Phone | Domicilio, teléfono, email | ✅ POC |
| Passport | Número, fechas, lugar emisión | ✅ POC |
| US Contact | Contacto en EUA | ✅ POC |
| Family | Padre, madre, familia en EUA | ✅ POC |
| Work/Education | Ocupación, empresa/escuela | ✅ POC |

---

## Notas técnicas

### Extracción del PDF
- Usa **PDF.js** (librería de Mozilla) para leer campos del formulario rellenable
- Los campos se identifican por `fieldName` en los widgets del PDF
- Fallback: si el PDF tiene nombres de campos no estándar, usa posicionamiento

### Llenado del DS-160
- Los IDs de campos del DS-160 siguen el patrón:
  `ctl00$SiteContentPlaceHolder$FormView1$[nombreCampo]`
- La extensión intenta múltiples variantes del selector para máxima compatibilidad
- Simula eventos nativos (`input`, `change`, `blur`) para formularios con validación JS

### Próximos pasos para v2.0
1. Inspeccionar el DS-160 real para mapear IDs exactos de cada campo
2. Agregar lógica de secciones condicionales (visa previa, acompañantes)
3. Añadir validación pre-llenado (alerta si campo obligatorio está vacío)
4. Log de campos llenados vs. no encontrados
5. Soporte para múltiples solicitantes en la misma sesión

---

## Estructura de archivos

```
visaspro-extension/
├── manifest.json      — Configuración de la extensión
├── popup.html         — Interfaz principal (UI del popup)
├── content.js         — Script que corre en ceac.state.gov
├── background.js      — Service worker
├── README.md          — Este archivo
└── icons/             — Íconos (agregar manualmente)
```

---

*VisasPro © 2025 — Desarrollado para uso interno del equipo de VisasPro*
