# Contexto del Proyecto — VisasPro DS-160 AutoFill

> Documento vivo. Se actualiza cada vez que se hace una modificación relevante al proyecto.
> Última actualización: 2026-08-10.

---

## 1. Qué es esto

Extensión de Chrome (Manifest V3) que automatiza el llenado del formulario **DS-160**
(solicitud de visa americana) en `ceac.state.gov`.

Flujo de negocio:
1. Un asesor de VisasPro carga en el side panel de la extensión el **PDF con los datos
   del cliente** (generado por el sistema interno VisasPro).
2. La extensión extrae los campos del PDF (AcroForm, o Claude Vision como fallback si el
   PDF viene "aplanado" sin campos de formulario).
3. Aplica mapeos/transformaciones para convertir esos datos a los códigos exigidos por el
   DS-160 (género, estado civil, país/estado, meses, ocupación, etc.).
4. Traduce al inglés los campos de texto libre (explicaciones, descripción de trabajo, etc.)
   usando la API de Claude.
5. El usuario, ya con el formulario DS-160 abierto en CEAC, pulsa botones de sección
   ("Pasaporte", "Viaje", "Familia"...) en el side panel y la extensión rellena el DOM real
   del formulario en la pestaña activa.
6. Puede generar un PDF de revisión combinando las páginas de revisión reales de CEAC.

**Nombre interno:** `VisasPro DS-160 AutoFill`
**Repo:** `github.com/jorgemolano29/Chrome-Extension`
**Manifest version actual:** `4.0.0`

---

## 2. Arquitectura y flujo de datos

```
 [Usuario]                [Side Panel: popup.html/popup.js]         [content.js en ceac.state.gov]
    │  sube PDF                     │                                          │
    ├──────────────────────────────▶│                                          │
    │                     parsePDFFields() (AcroForm regex)                    │
    │                     ó extractWithClaudeVision() (fallback, Claude Opus)   │
    │                     buildClientData() + mappings.js (processField)       │
    │                     translateFields() (Claude Haiku, ES→EN)              │
    │                     guarda en chrome.storage.local (visasproClientData)  │
    │                                │                                         │
    │  clic botón de sección         │   chrome.tabs.sendMessage                │
    │                                ├────────{action:'fill', section}────────▶│
    │                                │                                         │ lee storage,
    │                                │                                         │ SECTION_HANDLERS[section]
    │                                │                                         │ rellena inputs/selects/
    │                                │                                         │ radios reales del DOM ASP.NET
    │  clic "→ Next"                 ├────────{action:'nextPage'}─────────────▶│ click en botón Next real
```

- **manifest.json** — MV3, side panel, content scripts solo en `ceac.state.gov/*`,
  permisos `activeTab/scripting/storage/sidePanel`, host permissions para CEAC y
  `api.anthropic.com`.
- **background.js** — service worker mínimo: solo configura
  `chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true})`. El listener de
  `onMessage` solo loguea, no hace relay real (vestigial).
- **popup.html / popup.js** (side panel) — UI de carga de PDF, config de API key,
  tarjeta de cliente, grid de botones de sección, botón de PDF de revisión.
- **mappings.js** — tablas de limpieza/equivalencia/reglas por campo (`CLEAN`, `EQUIV`,
  `FIELD_RULES`) + `processField()` + `getTranslatableFields()`. Se inyecta como content
  script y también lo usa `popup.js`.
- **content.js** — handlers de llenado por sección del DS-160 real, navegación multi-página,
  generación del PDF de revisión.
- **lib/** — `pdf.js` de Mozilla (sin modificar), usado solo por `popup.js` para rasterizar
  el PDF a imágenes cuando se necesita Claude Vision.

---

## 3. Detalle por archivo

### popup.js / popup.html (side panel)
- Config: guarda la API key de Anthropic del usuario en `chrome.storage.local` bajo
  `vp_api_key` (valida prefijo `sk-ant-`).
- `parsePDFFields()` — parsea el PDF **a mano con regex** sobre objetos `/Widget` del
  AcroForm (no usa pdf.js para esto). Extrae `/T` (nombre) y `/V` (valor), resuelve hijos
  vía `/Parent`.
- Fallback Claude Vision (`extractWithClaudeVision`, modelo `claude-opus-4-5`): se activa
  si se detectan <30 campos (PDF aplanado); requiere confirmación del usuario
  (`askClaudeVision`, avisa costo ~$0.10 USD); usa `pdf.js` (`pdfToImages`) para convertir
  páginas a JPEG y las envía junto con la lista exacta de claves esperadas.
- `translateFields()` (modelo `claude-haiku-4-5-20251001`) — traduce campos marcados
  `translate:true` en `FIELD_RULES`.
- `buildClientData()` — mapea claves del PDF a claves internas de `clientData` usando
  `processField()` de mappings.js.
- Todas las llamadas a la API van directo desde el navegador con header
  `anthropic-dangerous-direct-browser-access: true` (sin backend proxy).
- Comunicación con la pestaña activa vía `chrome.tabs.sendMessage`.

### mappings.js
- `CLEAN` — limpieza de texto/email/teléfono/zip/número de visa.
- `EQUIV` — tablas texto→código DS-160: género, estado civil, meses, país/estado
  (32 estados MX + ~190 países), estados de USA, relaciones familiares, ocupación, idioma,
  redes sociales, etc.
- `FIELD_RULES` — regla por cada `pdfKey` (`clean`/`equiv`/`raw`/`translate`), cubre todas
  las secciones del DS-160 (PI1/PI2, Dirección, Viaje, Acompañantes, Viajes previos,
  Pasaporte, Contacto EUA, Familia, Pareja, Trabajo actual/anterior, Estudios, Adicional).
- `processField()` — aplica la regla; normaliza acentos/mayúsculas para tolerar variaciones
  del PDF; si no hay match, `console.warn` y devuelve el valor sin transformar.

### content.js (inyectado en ceac.state.gov)
- Primitivas: `fillInput`, `fillSelect`, `fillRadio`, `fillCheckbox` — disparan eventos DOM
  reales (`input`/`change`/`blur`/`.click()`).
- `waitFor(id, timeout=3000)` — espera aparición de un elemento vía `MutationObserver`
  (para campos que ASP.NET habilita tras postback/AJAX).
- Un handler por sección: `fillPI1`, `fillPI2`, `fillTravel`, `fillCompanions`,
  `fillPrevTravel`, `fillAddress`, `fillPassport`, `fillContact`, `fillFamily`,
  `fillSpouse`, `fillWork`, `fillWorkPrev`, `fillAdditional`, `fillSecurity`, routeados
  por `SECTION_HANDLERS`.
- `fillWork` — caso especial: si los campos no existen aún, hace un **postback manual vía
  `fetch`** simulando `__EVENTTARGET`/`__EVENTARGUMENT` de ASP.NET para forzar
  occupation="Empleado" y regenerar el DOM.
- `fillSecurity` — sección con 5 sub-páginas; detecta en cuál está
  (`detectSecurityPart`), marca todo "No", y si no es la última, guarda
  `vp_security_continue` en storage y hace clic en "Next"; un IIFE al cargar el script
  detecta ese flag y continúa automáticamente en la parte siguiente.
- `generateReviewPDF()` — hace `fetch` a las páginas reales de revisión de CEAC, arma un
  HTML combinado con los estilos reales + logo embebido en base64, y llama a
  `window.print()` en una ventana nueva.
- Logging: prefijo `[VP]` para detalle de llenado campo a campo, `[VisasPro]` para eventos
  de alto nivel.

### manifest.json
- `manifest_version: 3`, `version: "4.0.0"`.
- `permissions`: activeTab, scripting, storage, sidePanel.
- `host_permissions`: `ceac.state.gov/*`, `api.anthropic.com/*`.
- `content_scripts`: `mappings.js` + `content.js` en `ceac.state.gov/*`, `document_idle`.
- `web_accessible_resources`: iconos + `lib/*.mjs` (necesario porque `popup.js` es un
  módulo ES que importa `pdf.min.mjs`).

---

## 4. Convenciones del proyecto

- Comentarios y textos de UI en **español**; nombres de funciones/variables en inglés
  (camelCase); claves de datos del PDF replican nomenclatura de VisasPro
  (`PI1_NOMBRE_SOLICITANTE`, mayúsculas + guion bajo).
- Logging con prefijos `[VisasPro]` (alto nivel) y `[VP]` (detalle campo a campo).
- Banners ASCII de sección al inicio de cada archivo, con un número de versión **dentro
  del propio código** (`v2.0`, `v2.1`) que **no está sincronizado** con
  `manifest.json.version` ni con los mensajes de commit.
- `chrome.storage.local` se usa no solo para persistencia sino como bus de coordinación
  de flujo multi-página entre popup/content/background (ej. `vp_security_continue`).
- Ver también memoria de convención de versionado semver del usuario (sidebar de Citius
  Gestor) — **actualmente no se aplica de forma consistente en este proyecto**; hay tres
  numeraciones de versión desincronizadas (manifest, comentarios de cabecera, mensajes de
  commit). Vale la pena alinear esto si se retoma trabajo activo aquí.

---

## 5. Problemas conocidos / deuda técnica detectada

- **`popup.js` (línea ~50)**: `ANTHROPIC_API_KEY` está hardcodeada como placeholder
  (`sk-ant-XXXX...`) y es la que usa `translateFields()` — **no** usa la key que el
  usuario guarda en el panel de configuración (`vp_api_key`). Si nadie sustituyó ese
  placeholder, la traducción ES→EN falla silenciosamente (cae a catch, devuelve el texto
  sin traducir). `extractWithClaudeVision()` sí usa correctamente `vp_api_key`. →
  **Revisar/unificar** cuál key debe usar cada llamada.
- **`background.js`**: el listener de `onMessage` no implementa el relay que el comentario
  promete; probablemente vestigial de una versión previa sin side panel.
- **`content.js`**: quedaron `console.log` de depuración (`hasOtherUSRelative raw:` /
  `hasOther procesado:`) de un bug ya resuelto de normalización Sí/No.
- **`fillSpouse`** reutiliza los mismos IDs de fecha de nacimiento que `PI1`
  (`ddlDOBDay`/`ddlDOBMonth`/`tbxDOBYear`) — acoplamiento implícito no documentado, podría
  romperse si CEAC cambia el layout de esa sección.
- El historial de git no permite diff incremental real: hubo una serie de commits
  "Delete <archivo>" seguida de re-subida completa del árbol, así que no se puede rastrear
  con `git log -p` qué cambió exactamente entre "Versión 4.0" y el HEAD actual.

---

## 6. Convención de versionado (vigente desde 2026-08-10)

Formato `MAJOR.MINOR.PATCH`, propio de este proyecto (no confundir con la convención de
Citius Gestor):

- **MAJOR** (primer dígito) → cambios grandes al sistema (nueva arquitectura, nuevo flujo
  completo, ej. pasar de popup clásico a side panel, o de parseo manual a un motor nuevo).
- **MINOR** (segundo dígito) → modificaciones o mejoras sobre funcionalidad ya existente
  (ej. agregar una sección nueva del DS-160, mejorar un mapeo, ajustar un handler).
- **PATCH** (tercer dígito) → arreglo de bugs.

Se reinició el conteo el 2026-08-10, tomando como punto de partida **1.4.0** (equivalente
al estado que traía el proyecto, que antes tenía tres numeraciones distintas y
desincronizadas: `manifest.json`=4.0.0, footer del popup="v4.0", cabeceras de
popup.js/content.js="v2.1", mappings.js="v2.0"). A partir de ahora **una sola fuente de
verdad**, actualizada en los 4 lugares en cada cambio:
- `manifest.json` → campo `version`
- `popup.html` → footer (`<div class="footer">`)
- Cabecera banner de `popup.js`, `content.js`, `mappings.js`

Regla: en cada modificación, subir el dígito correspondiente y resetear los dígitos a su
derecha a 0 (ej. un bug fix sobre 1.4.0 → 1.4.1; una mejora de funcionalidad → 1.5.0; un
cambio grande de arquitectura → 2.0.0).

## 7. Historial de versiones previo (git log, antes de la nueva convención)

| Commit | Mensaje | Nota |
|---|---|---|
| `bef3bcc` | nueva versión | HEAD antes de retomar el proyecto |
| `90425e4`…`832a4f3` | serie de "Delete `<archivo>`" | borrado y re-subida completa del repo |
| `430430d` | Fix de API config | |
| `5cb104a` | Versión 4.0 | cambio a side panel |
| `c95e05c` | Versión 5, procesamiento Claude Visión seleccionable | anterior cronológicamente a "Versión 4.0" pero numerada más alta — inconsistencia (ya resuelta, ver sección 6) |
| `991eb66` | Versión 4.0, integración con Claude | |
| `35875f7` | nueva versión | |
| `13b5df6` | Nueva versión V2 | |

---

## 8. Registro de cambios (changelog de este documento / del proyecto)

> A partir de aquí se añade una entrada cada vez que se haga una modificación al proyecto
> con ayuda de Claude Code. Formato: versión, fecha, resumen del cambio, archivos tocados,
> por qué.

### v1.4.0 — 2026-08-10 — Creación de este documento de contexto
- Se generó este archivo `CONTEXTO_PROYECTO.md` mediante análisis completo del código
  (manifest.json, background.js, popup.html, popup.js, mappings.js, content.js, lib/,
  icons/) y del historial de git.
- No se modificó ningún archivo del proyecto, solo se documentó el estado actual.
- Pendiente para el usuario: decidir si vale la pena resolver la inconsistencia de la API
  key hardcodeada en `popup.js` y limpiar los `console.log` de depuración en `content.js`.

### v1.4.0 — 2026-08-10 — Adopción de convención de versionado propia
- Se definió la convención MAJOR.MINOR.PATCH descrita en la sección 6.
- Se unificó la versión (antes desincronizada en 4 lugares distintos: 4.0.0 / v4.0 /
  v2.1 / v2.0) a **1.4.0** en los 4 puntos donde vivía el número:
  - `manifest.json` (campo `version`: 4.0.0 → 1.4.0)
  - `popup.html` (footer: v4.0 → v1.4.0)
  - `popup.js` (cabecera banner: v2.1 → v1.4.0)
  - `content.js` (cabecera banner: v2.1 → v1.4.0)
  - `mappings.js` (cabecera banner: v2.0 → v1.4.0)
- No se tocó lógica de negocio, solo strings de versión.

### v1.4.1 — 2026-08-10 — Quitar botones de flecha "Next" junto a cada sección
- El grid de secciones (`popup.html`) tenía, junto a cada botón de sección
  (Personal Info 1, Pasaporte, Familia, etc.), un botón adicional con una flecha "→"
  (`.btn-next`) que enviaba `{action:'nextPage'}` al content script para avanzar de
  página en el DS-160. El usuario indicó que ya no es necesaria.
- Cambios:
  - `popup.html`: se quitaron los 14 botones `.btn-next` y el `<div class="btn-row">`
    que envolvía cada par (sección + flecha); ahora cada `.btn-section` es un item
    directo del grid de 2 columnas (`.btn-grid`). Se eliminaron las reglas CSS
    `.btn-row`, `.btn-next`, `.btn-next:hover` y `.btn-row.full` (ya sin uso).
  - `popup.js`: se eliminó el listener `document.querySelectorAll('.btn-next')` y la
    función `goToNextPage()` que ya no se usaba en ningún otro lado.
- Versión: 1.4.0 → **1.4.1** (bug/limpieza de UI, no funcionalidad nueva).

### v1.4.1 (cont.) — 2026-08-10 — Limpieza del código muerto de `nextPage` en content.js
- Con la eliminación de los botones de flecha, nada volvía a enviar
  `{action:'nextPage'}` al content script. Se limpiaron las dos piezas de código que
  quedaban huérfanas en `content.js`:
  - `SECTION_HANDLERS.nextPage` — handler duplicado, además ya era inalcanzable antes
    (el dispatcher solo enruta por `message.action === 'fill'`, nunca por sección
    `'nextPage'`).
  - El bloque `if (message.action === 'nextPage') { ... }` dentro del listener
    principal de `chrome.runtime.onMessage` — era el que realmente atendía el botón de
    flecha (clic en `ctl00_SiteContentPlaceHolder_UpdateButton3` + supresión del
    diálogo `beforeunload`).
- No se tocó la lógica de `fillSecurity`/auto-continuación multi-página de Security, que
  usa su propio flag (`vp_security_continue`) y clic directo al mismo botón Next de
  forma independiente — sigue intacta.
- Sin deuda técnica pendiente de este cambio.

### v1.4.2 — 2026-08-10 — Bug: letra "Y" espuria en campos con acentos (ñ, á, é...)
- **Síntoma reportado**: al procesar el PDF de una clienta ("Monica Guadalupe Felix
  Castañon"), la tarjeta del panel mostraba el apellido como **"YFELIX CASTANON"** — una
  "Y" de más al inicio.
- **Causa raíz**: cuando el generador del PDF (Sejda) guarda un valor de campo con
  caracteres no-ASCII (ñ, á, é, í, ó, ú...), lo codifica como **UTF-16BE con BOM**
  (`FE FF` + 2 bytes por carácter), en vez de texto plano de 1 byte por carácter.
  `parsePDFFields()` (popup.js) construye el string del PDF leyendo **un char JS por
  byte**, y `decodePDFString()` no reconocía ese BOM/UTF-16 — devolvía los bytes crudos
  tal cual. Al pasar ese valor por `CLEAN.text()` (mappings.js), que hace
  `normalize('NFD')` + elimina marcas diacríticas + elimina no-ASCII:
  - El byte `0xFF` del BOM es el carácter Unicode `ÿ` (y con diéresis), que bajo NFD se
    descompone en `y` + marca combinante → la marca se elimina pero la **"y" sobrevive**
    y termina en mayúscula al inicio del valor.
  - El byte `0xFE` (`þ`) no tiene forma de descomposición, así que se elimina en el paso
    de "quitar no-ASCII" sin dejar rastro.
  - Resultado neto: aparece una "Y" espuria pegada al inicio de **cualquier** campo del
    PDF que contenga una letra acentuada.
- **Alcance real del bug** (verificado contra el PDF de este caso, no solo el nombre):
  afectaba también, por ejemplo, `FAM_APELLIDO_MADRE` ("Castañon Aguirre" →
  "YCASTANON AGUIRRE"), `ADD_IDIOMA_1` ("Español"), `WET_PRESENT_ACTIVIDADES`
  ("aplicación de Uñas", campo `translate`). Es decir, llevaba tiempo corrompiendo
  silenciosamente cualquier campo con acento (muy común en nombres/apellidos
  mexicanos) en clientes procesados anteriormente con esta extensión.
- **Fix** (`popup.js`, función `decodePDFString`): se agregó detección del BOM UTF-16BE
  (`charCodeAt(0)===0xFE && charCodeAt(1)===0xFF`) — si está presente, se decodifica
  correctamente combinando pares de bytes en vez de tratarlos como bytes sueltos.
  Verificado manualmente contra los bytes reales del PDF de prueba: `PI1_APELLIDOS_
  SOLICITANTE` ahora decodifica a `Felix Castañon` → tras limpieza de acentos queda
  `FELIX CASTANON` (sin la "Y").
- **Nota**: los DS-160 ya llenados/enviados para clientes anteriores con nombres/apellidos
  acentuados pudieron haber tenido esta misma corrupción sin que se notara (la "Y" pasa
  desapercibida si no se revisa con cuidado el campo). Vale la pena que el usuario revise
  clientes recientes con apellidos con ñ/acentos si el DS-160 ya fue enviado.
- Versión: 1.4.1 → **1.4.2** (bug fix).

### v1.4.3 — 2026-08-10 — Auditoría Personal Info 1 + fix de maxlength transversal
- Se inició una revisión sección por sección del DS-160 real contra lo que rellena la
  extensión. Metodología: el usuario extrae del DOM real (vía script de consola) el
  `id`, tipo y `maxLength` de cada campo visible de la sección, se compara contra
  `fillPI1`/`FIELD_RULES`/`buildClientData`.
- **Bug encontrado (transversal a todas las secciones, no solo PI1)**: `fillInput()`
  (content.js) hacía `el.value = value` sin respetar `el.maxLength`. El atributo HTML
  `maxlength` solo limita lo que el usuario teclea, **no** una asignación por script —
  así que el campo quedaba en el DOM con más caracteres de los que el formulario
  declara aceptar, y CEAC lo rechazaba (o crasheaba) al hacer submit/"Next". Esto
  explica los crashes reportados al avanzar de página.
  - **Fix**: `fillInput()` ahora recorta el valor a `el.maxLength` antes de asignarlo
    (con `console.warn` si hubo recorte). Aplica automáticamente a **todas** las
    secciones que usan este helper (PI1, PI2, Travel, Address, Passport, etc.), no solo
    Personal Info 1.
  - Ejemplos de campos de PI1 con límites ajustados que motivaron el fix:
    `tbxAPP_SURNAME`/`tbxAPP_GIVEN_NAME` (maxlength 33), `tbxAPP_POB_CITY`/
    `tbxAPP_POB_ST_PROVINCE` (maxlength 20), `tbxDOBYear` (maxlength 4).
- **Gap encontrado y corregido en PI1**: el checkbox `cbexAPP_POB_ST_PROVINCE_NA`
  ("Does Not Apply" del estado/provincia de nacimiento) no se tocaba nunca. Si
  `data.birthState` viene vacío/"no aplica", `fillPI1` ahora marca ese checkbox en vez
  de dejar el campo de texto vacío sin más (que CEAC podía marcar como requerido sin
  completar).
- **Resultado de la auditoría de campos de Personal Info 1** (comparando el DOM real
  contra `fillPI1`): todos los demás campos visibles de la sección ya estaban
  correctamente mapeados — `tbxAPP_SURNAME`, `tbxAPP_GIVEN_NAME`,
  `cbexAPP_FULL_NAME_NATIVE_NA` (se marca N/A siempre, correcto para alfabeto latino),
  `rblOtherNames`/`rblTelecodeQuestion` (fijos en "No" — ver nota abajo),
  `ddlAPP_GENDER`, `ddlAPP_MARITAL_STATUS`, `ddlDOBDay/Month`, `tbxDOBYear`,
  `tbxAPP_POB_CITY`, `tbxAPP_POB_ST_PROVINCE`, `ddlAPP_POB_CNTRY`.
- **Nota/limitación conocida, no corregida** (fuera de alcance de este fix): `rblOtherNames`
  y `rblTelecodeQuestion` siempre se marcan "No" sin revisar si el cliente reportó otros
  nombres usados. Si algún cliente sí tiene otros nombres, esa parte condicional del
  formulario no se llenaría — evaluar si vale la pena mapear en un cambio futuro.
- Versión: 1.4.2 → **1.4.3** (bug fix).
- Herramienta nueva para próximas secciones: script de consola en
  `dump-ds160-fields.js` (scratchpad de la sesión) que extrae id/tipo/maxLength/opciones
  de todos los campos visibles de la página actual del DS-160 y copia el JSON al
  portapapeles — se reutilizará sección por sección (PI2, Travel, Companions, ...).
  Nota: pegar la variante **minificada en una sola línea** (`dump-ds160-fields.min.js`)
  — la versión multilínea puede romperse al pegar en la consola de Chrome por el
  auto-cierre de brackets del editor de DevTools (`Uncaught SyntaxError`).

### v1.4.3 (cont.) — 2026-08-10 — Auditoría Personal Info 2 — sin cambios de código
- Se comparó el DOM real de PI2 contra `fillPI2` (content.js): todos los campos visibles
  ya estaban cubiertos (`ddlAPP_NATL`, `rblAPP_OTH_NATL_IND`, `rblPermResOtherCntryInd`,
  `tbxAPP_NATIONAL_ID`/`cbexAPP_NATIONAL_ID_NA` vía CURP, `cbexAPP_SSN_NA`/
  `cbexAPP_TAX_ID_NA` marcados "No aplica" sin llenar los campos de texto asociados —
  correcto, ya que al marcar el checkbox CEAC deshabilita esos campos).
- **Decisión de negocio revisada con el usuario** (no bug, no requería fix): el campo
  Nacionalidad (`ddlAPP_NATL`) está hardcodeado a `'MEX'` y no se lee de ningún campo del
  PDF — el único dato de país que llega del PDF (`data.nationality` /
  `PI1_PAIS_REGION_SOLICITANTE`) se usa solo para "País de nacimiento" en PI1, que no
  siempre coincide con la nacionalidad actual. **Decisión: se deja fijo en MEX** — la
  base de clientes de VisasPro es 100% de nacionalidad mexicana. Revisar si esto cambia
  si en algún momento se atiende a clientes de otra nacionalidad.
- Sin cambios de código ni de versión en esta sección.

### v1.4.3 (cont.) — 2026-08-10 — Auditoría Inf. de Viaje — sin cambios de código
- Se auditó el DOM real de la sección Travel en 3 rondas (algunos campos son
  condicionales: Purpose of Trip → Other Purpose; Specific Travel Plans → fecha de
  llegada/duración/dirección de hospedaje; Who Is Paying → datos del pagador).
- Todos los campos capturados ya estaban mapeados en `fillTravel`: `ddlPurposeOfTrip`,
  `ddlOtherPurpose`, `rblSpecificTravel`, `ddlTRAVEL_DTEDay/Month`+`tbxTRAVEL_DTEYear`,
  `tbxTRAVEL_LOS`(maxlength 3)+`ddlTRAVEL_LOS_CD`, `tbxStreetAddress1`(maxlength 40),
  `tbxCity`(20), `ddlTravelState`, `tbZIPCode`(10), `ddlWhoIsPaying`,
  `tbxPayerSurname`/`tbxPayerGivenName`(33), `tbxPayerPhone`(15),
  `ddlPayerRelationship`, `rblPayerAddrSameAsInd`. `tbxPAYER_EMAIL_ADDR` sin llenar pero
  con su checkbox "Does Not Apply" marcado — correcto, mismo patrón que SSN/Tax ID.
- **Campo sin mapeo encontrado**: `tbxStreetAddress2` ("Street Address Line 2" del
  hospedaje en EUA, maxlength 40) — no existe ningún campo en el PDF de VisasPro que lo
  alimente (`TRA_HOSPEDAJE_CALLE` es una sola línea).
  - **Decisión del usuario**: dejarlo vacío. Line 2 es opcional en el DS-160 real; si la
    dirección de `TRA_HOSPEDAJE_CALLE` supera los 40 caracteres de Line 1, se sigue
    truncando (comportamiento ya existente vía el fix de `fillInput`/`maxLength` de
    v1.4.3), sin repartir el sobrante a Line 2. **No se implementó** la opción de
    auto-desbordar a Line 2 que se propuso como alternativa.
- Sin cambios de código ni de versión en esta sección.

### v1.4.4 — 2026-08-10 — Bug: unidad de duración del viaje ("Día(s)") no se llenaba
- **Síntoma reportado**: en la sección Travel, el número de la duración del viaje se
  llenaba bien pero el dropdown de unidad (Día(s)/Semana(s)/Mes(es)/Año(s)) se quedaba
  sin seleccionar.
- **Causa raíz**: mismo problema de fondo que el bug de la "Y" espuria (v1.4.2) — el
  valor viene en UTF-16BE por el acento de "Día(s)" — pero con una complicación extra:
  el PDF **escapa los paréntesis `(` `)` con `\`** (obligatorio por el formato PDF,
  incluso dentro de texto UTF-16, ya que son los delimitadores de cualquier cadena
  literal). El fix de `decodePDFString` de v1.4.2 reagrupaba bytes de a 2 en 2 sin
  quitar antes esos escapes, así que cualquier valor con paréntesis (como "Día(s)")
  quedaba desalineado y nunca decodificaba a texto legible → `processField`/`equiv` no
  encontraba coincidencia en `EQUIV.travelDurationUnit` → `fillSelect` no seleccionaba
  nada.
- **Fix**: `decodePDFString` ahora desescapa `\(`, `\)`, `\\` y las secuencias octales
  **antes** de reagrupar los pares UTF-16BE (solo en la rama con BOM). Verificado
  manualmente contra los bytes reales del PDF de prueba: `TRA_DURACION_UNIDAD` ahora
  decodifica a `Día(s)` → normalizado a `DIA(S)` → coincide con la tabla de
  equivalencias y devuelve `'D'`.
- **Alcance**: este bug podía afectar cualquier campo `equiv`/`clean` cuyo valor real
  tuviera a la vez un acento (que activa la codificación UTF-16BE) y un paréntesis,
  backslash, o los dispare la codificación octal — no solo la duración del viaje.
- Versión: 1.4.3 → **1.4.4** (bug fix).
- **Nota — hallazgo aparte, pendiente de confirmar**: revisando `EQUIV.travelDurationUnit`
  (mappings.js) de paso, la tabla solo tiene `Dia(s)`→D, `Semana(s)`→W, `Mes(es)`→M —
  **falta** una entrada para `Año(s)` (Year) y para "Less Than 24 Hours", que sí son
  opciones reales del dropdown de CEAC. Si algún cliente tiene una estancia en años o
  menos de 24 horas, hoy ese campo tampoco se llenaría (mismo síntoma, causa distinta).
  Pendiente de decidir con el usuario si se agregan esos códigos.

### v1.4.5 — 2026-08-10 — Agregar Año(s) y Menos de 24 Horas a duración del viaje
- Decisión del usuario: sí agregar ambos códigos faltantes en
  `EQUIV.travelDurationUnit` (mappings.js).
- Se agregaron `'Ano(s)': 'Year(s)'` y `'Menos de 24 Horas': 'Less Than 24 Hours'`.
- **Nota importante**: a diferencia de `Dia(s)`/`Semana(s)`/`Mes(es)` (mapeados a
  códigos cortos `D`/`W`/`M`, ya verificados en producción), no se conoce el `value`
  interno real de las opciones "Year(s)" y "Less Than 24 Hours" en el `<select>` de
  CEAC — no se ha visto ningún cliente con esos valores todavía para confirmarlo. Se
  mapearon al **texto visible** de la opción en inglés, aprovechando que `fillSelect()`
  compara tanto por `value` como por `text` del `<option>`. Si el texto exacto de la
  opción en el DS-160 real difiere, o si el PDF de VisasPro usa una etiqueta distinta a
  "Ano(s)"/"Menos de 24 Horas" para estos valores, hay que ajustar la clave española o
  el valor de esta tabla la primera vez que aparezca un cliente real con ese caso.
- Versión: 1.4.4 → **1.4.5** (bug fix / cobertura de mapeo).

### v1.5.0 — 2026-08-11 — Regla de negocio: dirección de hospedaje por defecto
- **Pedido del usuario**: en la sección Travel, si el PDF de VisasPro no trae ninguno de
  los 4 campos de "Address Where You Will Stay in the U.S." (`tbxStreetAddress1`,
  `tbxCity`, `ddlTravelState`, `tbZIPCode`), usar una dirección por defecto en vez de
  dejar el bloque vacío (CEAC no deja avanzar sin esta dirección), y avisar en pantalla
  que se usaron valores por defecto.
- **Valores por defecto** (`DEFAULT_TRAVEL_ADDRESS`, content.js): Street = `1921 S 10th
  St`, City = `McAllen`, State = `TX`, ZIP = `78503`.
- **Condición**: solo se activa si los 4 campos vienen vacíos/"no aplica" a la vez
  (`isBlank()` sobre los 4). Si viene aunque sea uno con dato, no se tocan los demás ni
  se aplican valores por defecto — se respeta el comportamiento previo.
- **Aviso en pantalla**: se agregó un tercer estilo de alerta (`.alert.warning`, ámbar)
  en `popup.html`, distinto de success/error. `fillTravel` ahora puede devolver
  `{ count, notices }` en vez de solo un número — el dispatcher de mensajes en
  `content.js` (listener de `chrome.runtime.onMessage`) soporta ambos formatos para no
  romper el resto de los handlers, que siguen devolviendo solo el número. `popup.js`
  (`fillSection`) muestra el conteo de campos llenados + el aviso ámbar cuando hay
  `notices`.
- Versión: 1.4.5 → **1.5.0** (funcionalidad nueva/modificación de comportamiento
  existente → MINOR, según la convención de la sección 6).

### v1.5.1 — 2026-08-11 — Auditoría Viajes Previos: 2 bugs corregidos
- Se auditó el DOM completo de la sección (viaje previo, visa previa, extravío,
  rechazo, cancelación, petición IV) contra `fillPrevTravel`. 4 hallazgos quedaron
  documentados pero **sin cambio** por decisión del usuario: (1) `cbxPREV_VISA_
  FOIL_NUMBER_NA` nunca se marca si `visaNumber` viene vacío; (2) `CLEAN.visa` recorta
  el número de visa previa a los últimos 8 dígitos numéricos, perdiendo letras si el
  número real es alfanumérico (el campo real acepta 12 caracteres); (3)
  `rblPREV_VISA_SAME_TYPE_IND`/`SAME_CNTRY_IND`/`TEN_PRINT_IND` fijos en "Sí" sin
  venir de ningún dato del PDF; (4) confirmado que `PUST_VISA_PREVIA_V_MES`
  (mappings.js) es una regla huérfana — el DS-160 real no pide fecha de vencimiento de
  la visa previa, solo de emisión. Se deja como está por ahora.
- **Bug encontrado y corregido — `tbxPREV_VISA_CANCELLED_EXPL` nunca se llenaba**: el
  PDF de VisasPro no tiene un campo propio para la explicación de "cancelación de
  visa", comparte el mismo texto que la pregunta de "rechazo" (`PUST_EXP_RECHAZO` /
  `visaRefusedExplanation`). El radio Sí/No de cancelación ya reutilizaba ese dato,
  pero el textarea de explicación nunca se llenaba. Fix en `fillPrevTravel`
  (content.js): cuando el radio de cancelación queda en "Sí", ahora también se llena
  `tbxPREV_VISA_CANCELLED_EXPL` con `data.visaRefusedExplanation` (que ya viene
  traducido, ver siguiente punto).
- **Bug encontrado y corregido — la traducción ES→EN nunca funcionó de verdad**: el
  usuario notó que `tbxPREV_VISA_REFUSED_EXPL` no salía en inglés pese a tener
  `translate: true`. Causa raíz: **el bug documentado desde el primer análisis del
  proyecto** (sección 5) — `translateFields()` (popup.js) usaba la constante
  hardcodeada `ANTHROPIC_API_KEY` (placeholder `sk-ant-XXXX...`) en vez de la key real
  guardada por el usuario (`vp_api_key`). La llamada a Claude fallaba siempre y el
  `catch` devolvía el texto original en español sin avisar — y encima el mensaje en
  pantalla decía igual "X campos traducidos" aunque la traducción hubiera fallado
  100% de las veces.
  - Fix: `translateFields()` ahora lee `vp_api_key` de `chrome.storage.local` (mismo
    patrón que ya usaba `extractWithClaudeVision`). Si no hay key configurada, **no
    intenta la llamada** (evita una petición que fallaría seguro) y lo señala
    explícitamente en el resultado.
  - `translateFields()` cambió su forma de retorno de `{...traducciones}` a
    `{ translated, ok, reason }` — se actualizó el único caller (`processPDF`) para
    leer el nuevo formato.
  - El mensaje final en el panel ahora es honesto: si la traducción realmente
    funcionó dice "X traducidos" (verde); si no hay API key configurada o la llamada
    falló, dice explícitamente que los campos quedaron en español (alerta ámbar), en
    vez de mentir con un mensaje de éxito genérico.
  - Se quitó la constante `ANTHROPIC_API_KEY` hardcodeada de `popup.js` (ya sin uso).
- **Impacto**: este fix de traducción aplica a **todos** los campos `translate: true`
  del formulario (no solo Viajes Previos) — ej. `WET_PRESENT_ACTIVIDADES` (Trabajo
  actual), explicación de extravío de pasaporte, etc. Si el usuario no tenía la API key
  configurada en ⚙️, es probable que ningún campo se haya traducido nunca en clientes
  anteriores — vale la pena verificar que la key esté guardada y volver a revisar
  DS-160 ya generados si aplicaba traducción.
- Versión: 1.5.0 → **1.5.1** (bug fix).

### v1.5.2 — 2026-08-11 — Corrección: cancelación de visa NO comparte dato con rechazo
- El usuario mostró la estructura real de la sección "3. VIAJES PREVIOS A EUA" del PDF
  de VisasPro: solo tiene 4 preguntas — (a) último viaje a EUA, (b) visa previa
  (emisión/vencimiento/número), (c) robo/extravío de visa (año + explicación), (d)
  rechazo de visa (explicación). **No existe ninguna pregunta de cancelación/revocación
  de visa en el PDF.**
- El fix de v1.5.1 asumía (seguía una lógica ya presente en el código desde antes de
  esta auditoría) que la pregunta de cancelación del DS-160 debía compartir la
  respuesta/explicación de la pregunta de rechazo. El usuario correctamente señaló que
  son legalmente preguntas distintas y que no hay base real en los datos del cliente
  para inferir la de cancelación a partir de la de rechazo.
- **Decisión del usuario**: `rblPREV_VISA_CANCELLED_IND` se deja **siempre en "No"**
  (sin depender de `visaRefusedExplanation`), y `tbxPREV_VISA_CANCELLED_EXPL` ya no se
  llena con nada. Se revierte el llenado de ese textarea agregado en v1.5.1.
- Si en el futuro VisasPro agrega una pregunta específica de cancelación a su PDF,
  habría que agregar el campo correspondiente en `mappings.js`/`popup.js` y actualizar
  este handler para usar el dato real en vez del valor fijo.
- Versión: 1.5.1 → **1.5.2** (bug fix — corrección de lógica de negocio incorrecta).

### v1.5.3 — 2026-08-11 — Auditoría Dirección: 2 checkboxes "Does Not Apply" corregidos
- Se comparó el DOM real de la sección Dirección contra `fillAddress`. Casi todo ya
  estaba mapeado (`tbxAPP_ADDR_LN1`, `tbxAPP_ADDR_CITY`, `ddlCountry`, teléfonos, email,
  redes sociales, radios de "otro contacto").
- **Campo sin mapeo, sin cambio** (mismo patrón que Travel): `tbxAPP_ADDR_LN2` ("Street
  Address Line 2" de la dirección de casa) — se deja vacío, aplicando la misma decisión
  que el usuario ya tomó para el Line 2 de la dirección de hospedaje en Travel (v1.4.3).
- **Bugs corregidos** (mismo gap técnico que `cbexAPP_POB_ST_PROVINCE_NA` en PI1,
  v1.4.3 — aplicado directo sin preguntar por ser el mismo patrón mecánico ya
  establecido): `cbexAPP_ADDR_STATE_NA` y `cbexAPP_ADDR_POSTAL_CD_NA` ("Does Not Apply"
  de estado y ZIP) nunca se tocaban. Ahora `fillAddress` marca esos checkboxes cuando
  `data.state`/`data.zip` vienen vacíos, en vez de dejar el campo de texto huérfano sin
  marcar nada.
- Versión: 1.5.2 → **1.5.3** (bug fix).

### v1.5.4 — 2026-08-11 — Race condition en el campo de red social (Dirección)
- **Síntoma reportado**: el campo de usuario/handle de red social
  (`dtlSocial_ctl00_tbxSocialMediaIdent`) a veces quedaba vacío. CEAC tarda ~1-2s en
  habilitar ese campo (vía AJAX) después de elegir la plataforma en
  `dtlSocial_ctl00_ddlSocialMedia`, y el código anterior solo esperaba un `setTimeout`
  fijo de 500ms antes de revisar si ya no estaba `disabled` — insuficiente si la red iba
  lenta.
- **Fix**: nuevo helper `waitForEnabled(id, timeout)` (content.js) — a diferencia de
  `waitFor()` (que espera a que un elemento **aparezca** en el DOM vía
  `MutationObserver` sobre `childList`), este espera a que un elemento que **ya existe**
  deje de tener el atributo `disabled`, observando ese atributo específico
  (`attributeFilter: ['disabled']`). Reacciona en el instante exacto en que CEAC lo
  habilita, sin depender de adivinar un tiempo fijo (timeout de seguridad: 4s).
  `fillAddress` ahora usa este helper en vez del `setTimeout` de 500ms.
- Versión: 1.5.3 → **1.5.4** (bug fix).

### v1.5.5 — 2026-08-11 — v1.5.4 no fue suficiente: waitForEnabled reescrito con polling
- El usuario probó v1.5.4 y el campo de red social seguía sin llenarse. Señal clave: al
  volver a darle clic al mismo botón de autofill (segunda ejecución completa de
  `fillAddress`), el campo "ya está visible" y sí se llena — es decir, la habilitación
  sí ocurre eventualmente, pero el mecanismo de espera no se enteraba.
- **Causa probable**: `waitForEnabled` (v1.5.4) usaba `MutationObserver` atado a la
  referencia del nodo `el` obtenida al inicio, observando su atributo `disabled`. Si
  CEAC reemplaza el nodo completo vía un postback parcial (patrón UpdatePanel de
  ASP.NET, ya visto en `fillWork`) en vez de solo cambiar el atributo del mismo
  elemento, el observer sigue mirando el nodo viejo (que nunca cambia) y nunca se
  entera de que apareció un nodo nuevo con el mismo id.
- **Fix**: `waitForEnabled` reescrito con **polling** — cada 150ms vuelve a hacer
  `document.getElementById(id)` desde cero (no reusa una referencia vieja) y revisa si
  existe y no está `disabled`. Esto es indiferente a si CEAC reemplaza el nodo, lo
  reconstruye, o solo cambia el atributo — siempre que la búsqueda por id lo encuentre
  habilitado, se resuelve. Timeout de seguridad subido a 5s.
- Versión: 1.5.4 → **1.5.5** (bug fix — el intento anterior no resolvió el problema).

### v1.5.6 — 2026-08-11 — Auditoría Pasaporte: 3 gaps + 1 bug de lógica corregidos
- Se comparó el DOM real de Pasaporte (incluyendo el bloque condicional de robo/
  extravío) contra `fillPassport`.
- **Gaps corregidos** (mismo patrón ya establecido en otras secciones):
  - `ddlPPT_ISSUED_CNTRY` ("Country/Authority that Issued Passport") — no se tocaba en
    absoluto. Fijado en `MEX`, igual que `dtlLostPPT_ctl00_ddlLOST_PPT_NATL` (misma
    función) y otros selects de país en el resto del proyecto.
  - `ddlPPT_ISSUED_IN_CNTRY` ("Country/Region" del lugar de emisión, dentro del bloque
    ciudad/estado/país) — tampoco se tocaba. Fijado en `MEX`.
  - `cbxPPT_EXPIRE_NA` ("No Expiration") — nunca se marcaba si
    `data.passportExpiry_year` viene vacío; ahora sigue el mismo patrón de checkbox NA
    que PI1/Dirección.
- **Bug de lógica corregido**: la pregunta "¿Le robaron/extravió el pasaporte?" exigía
  que **tanto** `passportLostNumber` **como** `passportLostExplanation` vinieran no
  vacíos para responder "Sí". Si un cliente reportaba el robo (tenía explicación) pero
  no sabía el número del pasaporte robado, la pregunta completa quedaba respondida como
  "No" — incorrecto. Decisión del usuario: la pregunta ahora depende **solo** de la
  explicación; si el número no está disponible, se marca el checkbox
  `dtlLostPPT_ctl00_cbxLOST_PPT_NUM_UNKN_IND` ("Do Not Know") en vez de dejar todo en
  "No".
- Versión: 1.5.5 → **1.5.6** (bug fix).

### v1.5.6 (cont.) — 2026-08-11 — Auditoría Contacto EUA — sin bugs encontrados
- Se auditó el DOM completo (rama persona/hotel, parentesco disparando dirección,
  dirección, email) contra `fillContact`. Todo estaba correctamente mapeado:
  `tbxUS_POC_SURNAME`/`GIVEN_NAME`, `cbxUS_POC_NAME_NA`, `tbxUS_POC_ORGANIZATION`,
  `cbxUS_POC_ORG_NA_IND`, `ddlUS_POC_REL_TO_APP`, dirección completa, `HOME_TEL`.
- `tbxUS_POC_ADDR_LN2` sin mapeo, mismo patrón Line 2 ya decidido (se deja vacío).
- `tbxUS_POC_EMAIL_ADDR` sin llenar — confirmado que **no es un gap**: el PDF de
  VisasPro no tiene ningún campo de email para el contacto en EUA, así que marcar
  "Does Not Apply" siempre es correcto.
- Sin cambios de código en esta ronda.

### v1.6.0 — 2026-08-11 — Regla de negocio: contacto en EUA por defecto
- **Pedido del usuario**: en la práctica, algunos clientes llenan absolutamente todo
  como "no aplica" en la sección 6 del PDF (ni persona de contacto ni hotel) — el
  DS-160 exige un contacto obligatoriamente (nombre/hotel + parentesco + dirección
  completa) y no deja avanzar sin él.
- **Condición del fallback**: se activa solo si **tanto** el nombre/apellido de la
  persona de contacto **como** el nombre del hotel vienen vacíos/"no aplica" a la vez
  (`isBlank()` sobre ambos). Si viene aunque sea uno de los dos, no se activa el
  fallback — se respeta el comportamiento previo.
- **Valores por defecto** (`DEFAULT_US_CONTACT`, content.js):
  - Hotel: `Wyndham Garden McAllen`
  - Parentesco: `OTHER`
  - Dirección: `1921 S 10th St`, `McAllen`, `TX`, ZIP `78503` (misma dirección física
    ya usada como default en la sección Travel, v1.5.0 — se reutilizó el mismo ZIP)
  - Teléfono: `19569940505`
- Cuando se activa, se llena la rama "hotel" (marca `cbxUS_POC_NAME_NA`="Do Not Know"
  del nombre de persona, llena `tbxUS_POC_ORGANIZATION` con el hotel, desmarca
  `cbxUS_POC_ORG_NA_IND`) en vez de la rama "persona".
- **Aviso en pantalla**: reutiliza el mecanismo de `notices`/alerta ámbar creado en
  v1.5.0 para el default de Travel — `fillContact` ahora devuelve `{ count, notices }`
  igual que `fillTravel`.
- Versión: 1.5.6 → **1.6.0** (funcionalidad nueva → MINOR, según la convención de la
  sección 6).

### v1.6.1 — 2026-08-11 — Auditoría Familia: 6 checkboxes NA + limpieza de debug logs
- Se comparó el DOM real (padre, madre, familiar inmediato en EUA, otro familiar en
  EUA) contra `fillFamily`.
- **Bugs corregidos** (mismo patrón mecánico ya usado en PI1/Dirección/Pasaporte):
  6 checkboxes "Do Not Know" nunca se tocaban —
  `cbxFATHER_GIVEN_NAME_UNK_IND`, `cbxFATHER_SURNAME_UNK_IND`, `cbxFATHER_DOB_UNK_IND`,
  `cbxMOTHER_GIVEN_NAME_UNK_IND`, `cbxMOTHER_SURNAME_UNK_IND`, `cbxMOTHER_DOB_UNK_IND`.
  Ahora `fillFamily` marca cada uno cuando el dato correspondiente viene vacío, en vez
  de dejar los campos de texto/fecha huérfanos.
- **Limpieza**: se quitaron los 2 `console.log` de depuración detectados desde el
  primer análisis del proyecto (`hasOtherUSRelative raw:` / `hasOther procesado:`),
  ya no eran necesarios (el bug de normalización Sí/No que motivó ese debug ya está
  resuelto).
- Resto de la sección (nombre/apellido/fecha de nacimiento de padre y madre cuando sí
  hay dato, "vive en EUA" fijo en No, familiar inmediato condicional, otro familiar)
  ya estaba correctamente mapeado.
- Versión: 1.6.0 → **1.6.1** (bug fix).

### v1.6.2 — 2026-08-11 — Auditoría Pareja: 1 checkbox NA corregido
- Se comparó el DOM real contra `fillSpouse`. Se confirmó que la reutilización de
  `ddlDOBDay`/`ddlDOBMonth`/`tbxDOBYear` (mismos IDs que Personal Info 1) es
  intencional y correcta — el DOM real de la sección Pareja etiqueta esos mismos
  controles como "Spouse's Date of Birth".
- **Bug corregido** (mismo patrón mecánico ya usado varias veces): `cbexSPOUSE_POB_CITY_NA`
  ("Do Not Know" de la ciudad de nacimiento de la pareja) nunca se tocaba. Ahora
  `fillSpouse` lo marca cuando `data.spouseBirthCity` viene vacío.
- Resto de la sección (nombre/apellido, nacionalidad, fecha de nacimiento, país de
  nacimiento, `ddlSpouseAddressType` fijo en "Same as Home Address") ya estaba
  correctamente mapeado.
- Versión: 1.6.1 → **1.6.2** (bug fix).

### v1.7.0 — 2026-08-11 — Nacionalidad de la pareja siempre MEX
- **Pedido del usuario**: el campo `ddlSpouseNatDropDownList` (nacionalidad de la
  pareja) debe quedar siempre fijo en `MEX`, sin depender del dato del PDF
  (`data.spouseNationality` / `PAREJA_NACIONALIDAD`) — mismo criterio ya aplicado a la
  nacionalidad del solicitante en Personal Info 2 (v1.4.3, sección de "Decisión de
  negocio").
- `data.spouseNationality` queda extraído del PDF pero ya no se usa en `fillSpouse` —
  se deja el mapeo del PDF intacto por si se vuelve a necesitar más adelante.
- Versión: 1.6.2 → **1.7.0** (modificación de funcionalidad existente → MINOR, según
  la convención de la sección 6).

### v1.8.0 — 2026-08-11 — Trabajo actual: soporte real para Estudiante/Retirado/Desempleado
- **Hallazgo (auditoría de código, no reportado por el usuario)**: `fillWork` forzaba
  **siempre** la ocupación a `'O'` (hardcodeado en el postback manual), sin importar
  que `data.occupation` ya viniera correctamente calculado como `'O'`/`'S'`/`'RT'`/`'N'`
  desde el PDF (`EQUIV.occupationCode` en mappings.js). Cualquier cliente
  Estudiante/Retirado/Desempleado se llenaba como si fuera Empleado.
- **Investigación del DOM real** (con el usuario probando manualmente cada opción del
  dropdown `ddlPresentOccupation`, fuera de la extensión): se confirmó que el
  dropdown real "Primary Occupation" **no tiene una opción genérica "Employed"** —
  solo categorías de industria + `STUDENT`/`RETIRED`/`NOT EMPLOYED`/`OTHER`. Los
  códigos reales coinciden exactamente con `EQUIV.occupationCode`:
  `O`=OTHER, `S`=STUDENT, `RT`=RETIRED, `N`=NOT EMPLOYED.
- **Campos por rama** (confirmado en vivo):
  - `O` (Otro/Empleado): campo "Explain" (`tbxExplainOtherPresentOccupation`) +
    bloque completo empleador (nombre/dirección/fecha/salario/actividades).
  - `S` (Student): el **mismo** bloque de campos que `O` (mismos IDs, `tbxEmpSchName`
    etc., solo cambia la etiqueta a "...or School Name"), pero **sin** el campo
    Explain.
  - `RT` (Retired): ningún campo adicional.
  - `N` (Not Employed): solo el campo Explain.
- **Bug adicional corregido**: el campo Explain usaba una lógica manual rota
  (`data.occupation === 'O' ? 'EMPLOYEE' : data.occupation`) que ponía "EMPLOYEE" o el
  código crudo ('S'/'RT'/'N') sin sentido. Ahora usa `data.occupationText` — ya
  calculado correctamente en `popup.js` desde `EQUIV.occupationText`
  (Empleado→EMPLOYEE, Desempleado→UNEMPLOYED, Otro→OTHER) pero nunca antes usado en
  `content.js`.
- **Fix del disparador del postback**: antes se disparaba si `tbxEmpSchName` no
  existía — pero ese campo **nunca existe** para RT/N, así que se cambió a comparar
  el valor actual de `ddlPresentOccupation` contra el código objetivo.
- **Decisiones del usuario para la rama Estudiante**:
  - Dirección de escuela: usa `data.schoolName/schoolStreet/schoolCity/schoolState/
    schoolZip/schoolCountry` (campos `EST_*` del PDF, ya extraídos pero sin usar antes
    en ningún lado de `content.js` para esta pantalla).
  - Salario: siempre "Does Not Apply".
  - "Briefly describe your duties": siempre el texto fijo `"Student"`.
- **Bug adicional corregido de paso** (mismo patrón mecánico de siempre):
  `cbxWORK_EDUC_ADDR_STATE_NA`/`cbxWORK_EDUC_ADDR_POSTAL_CD_NA` nunca se tocaban ni
  para Empleado ni para Estudiante — ahora se marcan si el estado/ZIP vienen vacíos.
- Versión: 1.7.0 → **1.8.0** (funcionalidad nueva/corrección de comportamiento
  incorrecto en 3 de 4 ramas → MINOR, según la convención de la sección 6).

### v1.8.1 — 2026-08-11 — Bug: salario mensual no se limpiaba (símbolos/comas)
- **Síntoma reportado**: `tbxCURR_MONTHLY_SALARY` debe llevar solo el número, sin
  signo de pesos, comas ni nada más.
- **Causa raíz**: `workSalary` (`WET_PRESENT_INGRESO_MXN`) se extraía con `r()` (valor
  crudo, sin ninguna regla en `FIELD_RULES`) — a diferencia de teléfono/ZIP que sí
  tienen su función de limpieza (`CLEAN.phone`/`CLEAN.zip`), este campo nunca se
  procesaba.
- **Fix**: nueva función `CLEAN.salary` en `mappings.js` — quita todo lo que no sea
  dígito o punto decimal, y descarta la parte decimal (ej. `"$15,000.00 MXN"` →
  `"15000"`). Se agregó la regla `'WET_PRESENT_INGRESO_MXN': { clean: 'salary' }` en
  `FIELD_RULES`, y `popup.js` ahora usa `p()` (con regla) en vez de `r()` (crudo) para
  este campo.
- Versión: 1.8.0 → **1.8.1** (bug fix).

### v1.8.2 — 2026-08-11 — Auditoría Trabajo anterior: 4 checkboxes NA corregidos
- El usuario reportó que la parte de Estudios no se llenaba, pero al probar de nuevo sí
  funcionó — no era un bug de código (posiblemente el PDF de prueba anterior no traía
  esos datos). Sin cambios por ese reporte.
- Se comparó el DOM completo (empleo previo + estudios) contra `fillWorkPrev`. Casi
  todo ya estaba mapeado, incluyendo el manejo de "Do Not Know" del supervisor que ya
  estaba bien implementado.
- **Bugs corregidos** (mismo patrón mecánico de siempre): 4 checkboxes "Does Not Apply"
  nunca se tocaban — `cbxPREV_EMPL_ADDR_STATE_NA`, `cbxPREV_EMPL_ADDR_POSTAL_CD_NA`
  (dirección del empleador anterior), `cbxEDUC_INST_ADDR_STATE_NA`,
  `cbxEDUC_INST_POSTAL_CD_NA` (dirección de la institución educativa). Ahora se marcan
  cuando el estado/ZIP correspondiente viene vacío.
- **Nota, sin cambio**: `tbxSchoolCourseOfStudy` (curso de estudio) tiene un límite de
  solo 66 caracteres — ajustado para un campo traducido; ya protegido por el recorte
  global de `maxLength` (v1.4.3), pero puede recortar cursos con descripciones largas.
- `tbEmployerStreetAddress2`/`tbxSchoolAddr2` (Line 2) sin mapeo — mismo patrón ya
  decidido, se dejan vacíos.
- Versión: 1.8.1 → **1.8.2** (bug fix).

### v1.9.0 — 2026-08-11 — País de institución educativa siempre MEX
- **Pedido del usuario**: `dtlPrevEduc_ctl00_ddlSchoolCountry` (país de la institución
  educativa, dentro de "Trabajo anterior") debe quedar siempre fijo en `MEX`, sin
  depender de `data.schoolCountry` (`EST_PAIS`) — mismo criterio ya aplicado a otros
  selects de país en el proyecto (nacionalidad, dirección, país de emisión de
  pasaporte, etc.).
- Versión: 1.8.2 → **1.9.0** (modificación de funcionalidad existente → MINOR, según
  la convención de la sección 6).

### v1.10.0 — 2026-08-11 — País del empleador anterior siempre MEX
- **Pedido del usuario**: `dtlPrevEmpl_ctl00_DropDownList2` (país del empleador
  anterior) debe quedar siempre fijo en `MEX`, sin depender de `data.prevWorkCountry`
  (`WET_PREV_PAIS`) — mismo criterio aplicado un momento antes al país de la
  institución educativa (v1.9.0).
- Versión: 1.9.0 → **1.10.0** (modificación de funcionalidad existente → MINOR, según
  la convención de la sección 6 — corregido de un bump de PATCH mal aplicado
  inicialmente).

### v1.11.0 — 2026-08-11 — Idiomas: traducción real vía Claude en vez de tabla fija
- **Investigación previa**: el usuario reportó que solo se llenaba el primer idioma
  (falta el clic en "Add Another" para revelar el 2º/3er campo). Se aisló el problema
  con pruebas manuales en consola: tanto el clic solo como la secuencia completa
  (llenar por script + clic inmediato, exactamente lo que hace `fillInput` +
  `.click()` en el código) **sí agregan la segunda fila correctamente** — el
  mecanismo en sí funciona. No se encontró bug de código en este punto; quedó
  pendiente confirmar en el flujo completo de la extensión si era un problema de datos
  (PDF con un solo idioma) o de timing bajo carga real — no reprodujo en las pruebas
  aisladas.
- **Pedido del usuario**: en vez de la tabla `EQUIV.language` (limitada a 6 idiomas:
  Español/Inglés/Francés/Alemán/Italiano/Portugués), traducir los idiomas con Claude
  (misma vía que actividades laborales, explicaciones de robo, etc.) para cubrir
  cualquier idioma que reporte un cliente.
- **Cambios**: `ADD_IDIOMA_1/2/3` en `FIELD_RULES` pasó de `{ equiv: 'language' }` a
  `{ clean: 'text', translate: true }`. Se agregó `ADD_IDIOMA_1/2/3` →
  `language1/2/3` en `TRANSLATE_KEY_MAP` (popup.js) para que la traducción real
  sobrescriba el valor limpio inicial. Se eliminó la tabla `EQUIV.language` (ya sin
  uso en ningún lado).
- Versión: 1.10.0 → **1.11.0** (modificación de funcionalidad existente → MINOR,
  según la convención de la sección 6).

### v1.11.1 — 2026-08-11 — Bug real: "Add Another" bloqueado por CSP de CEAC
- **Síntoma**: el usuario confirmó que en el flujo completo de la extensión solo se
  llenaba el primer idioma; los idiomas/países 2 y 3 nunca aparecían, sin ningún error
  visible.
- **Diagnóstico**: la consola del navegador reveló la causa real —
  `Running the JavaScript URL violates the following Content Security Policy
  directive 'script-src'... fillAdditional @ content.js`. Los enlaces "Add Another" de
  los repetidores ASP.NET (idiomas, países visitados) usan
  `href="javascript:__doPostBack('target','')"`. El CSP real de CEAC bloquea la
  ejecución de URLs `javascript:` cuando el `.click()` lo dispara un **content
  script** — pero la consola de DevTools no está sujeta a esa misma restricción, por
  eso las pruebas manuales del `.click()` (incluida la que hizo el usuario) sí
  funcionaban, dando una falsa sensación de que el mecanismo estaba bien. El bloqueo no
  lanza ningún error capturable por JS, así que el código simplemente seguía de largo
  después de que `waitFor`/`waitForExists` agotaran su tiempo de espera sin que la
  fila apareciera.
- **Fix**: nueva función `clickPostbackLink(el)` en `content.js` — en vez de hacer
  `.click()` en el enlace, extrae el `__EVENTTARGET`/`__EVENTARGUMENT` de su atributo
  `href` (regex sobre `__doPostBack('target','arg')`) y simula el postback
  manualmente vía `fetch` + reemplazo de `#aspnetForm.innerHTML`, exactamente igual
  que ya hace `fillWork()` para forzar la ocupación. Se reemplazaron los 4 `.click()`
  de "Insert" en `fillAdditional` (idiomas ×2, países ×2) por este helper.
- **Alcance**: este bug era específico de los repetidores con enlaces "Add
  Another"/"Insert" (idiomas y países visitados en esta sección); otros `.click()`
  del proyecto son sobre elementos `<input type="radio">`/`<input type="submit">`
  reales (sin `href`), que no están sujetos a esta restricción de CSP.
- Versión: 1.11.0 → **1.11.1** (bug fix).

### 2026-08-11 — Auditoría Adicional — sin bugs encontrados
- Se auditó el DOM completo (clan/tribu, idiomas ×2 filas, países visitados con el
  select revelado, y las 4 preguntas fijas de organización/habilidades/militar/
  insurgente) contra `fillAdditional`. Todo coincide exactamente con lo ya mapeado.
- Se resolvió la duda pendiente sobre por qué el 3er idioma/país no hace clic en
  "Insertar": es intencional, al ser el último slot (el DS-160 limita a 3 entradas)
  no hace falta agregar una fila más.
- Sin cambios de código ni de versión en esta sección.

### v1.11.2 — 2026-08-11 — Bug: código de México mal (MXN en vez de MEX)
- Al preparar la lista de referencia para el matching de países por IA, se comparó
  toda la tabla `EQUIV.countries` (~190 entradas) contra la lista real de opciones del
  select `dtlCountriesVisited_ctl00_ddlCOUNTRIES_VISITED` en el DOM. Solo se encontró
  **un** error: `'MEXICO': 'MXN'` — el valor real es `MEX`. El resto de la tabla
  coincide perfectamente con el DOM real.
- **Impacto real**: `EQUIV.countries` se usa en `EST_PAIS` (país de la institución
  educativa), que sigue activo en la rama Estudiante de `fillWork` (`data.schoolCountry
  || 'MEX'` — el `|| 'MEX'` nunca se activaba porque el valor no venía vacío, venía
  con el código incorrecto `MXN`). Con México siendo previsiblemente el país más común
  para este campo, es probable que esa selección llevara tiempo fallando en silencio.
  Los otros usos de `EQUIV.countries` (`PAREJA_NACIONALIDAD`, `WET_PREV_PAIS`) ya
  habían quedado sin uso al fijarse en `MEX` directo en v1.7.0/v1.10.0.
- Fix: `'MEXICO': 'MEX'` en `mappings.js`.
- Versión: 1.11.1 → **1.11.2** (bug fix).

### v1.12.0 — 2026-08-11 — Países visitados: matching contra lista cerrada vía IA
- **Pedido del usuario**: a diferencia de idiomas (traducción libre, resuelto con
  Claude en v1.11.0), países visitados es un problema de **matching contra una lista
  cerrada** de ~190 opciones válidas del DS-160. La tabla fija `EQUIV.countries` no
  cubre variantes/abreviaciones que el PDF pueda traer (ej. "EEUU", "Holanda" en vez
  de "Países Bajos"). Se pidió que la IA identifique el país real y elija la opción
  correcta de la lista, sin modificar el PDF de VisasPro.
- **Implementación** (`popup.js`): nueva función `matchCountriesWithAI(rawCountries)`
  — mismo patrón que `translateFields()` (Claude Haiku, usa `vp_api_key` real, mismo
  manejo honesto de fallback si no hay API key o la llamada falla). El prompt incluye
  el texto crudo de país1/2/3 **más la lista completa de opciones válidas**
  (`EQUIV.countries`, ya corregida en v1.11.2) en formato `CODE::NOMBRE`, y le pide a
  Claude el código exacto de la mejor coincidencia (o `null` si no está seguro).
- Se integró en `processPDF()`: corre después de la traducción, solo si hay al menos
  un país con dato. Si la IA da una respuesta con código, sobrescribe
  `data.country1/2/3` (que ya traían el valor de la tabla fija como respaldo,
  calculado en `buildClientData`); si la IA no está segura (`null`) o falla, se
  queda el valor de la tabla fija sin cambios.
- **Aviso en pantalla**: mensaje del panel ahora es una lista de `notices`
  combinables (traducción + matching de países), en vez del if/else único de antes —
  si el matching de países falla o no hay API key, se avisa en la misma alerta ámbar
  sin bloquear el resto del procesamiento.
- Versión: 1.11.2 → **1.12.0** (funcionalidad nueva → MINOR, según la convención de
  la sección 6).

### v1.13.0 — 2026-08-11 — Lugar de nacimiento (PI1): identificación con IA
- **Pedido del usuario**: algo similar para `ddlAPP_POB_CNTRY` (país/región de
  nacimiento, PI1) — su PDF actual no trae el campo `PI1_PAIS_REGION_SOLICITANTE`,
  así que quiere que la IA lo determine.
- **Antes de implementar, el usuario pidió ver las opciones reales del DOM primero**
  (`no quieres ver las opciones pimero?`) — se pidió el dump de
  `ddlAPP_POB_CNTRY` y se comparó contra `EQUIV.paisRegion` (que resultó ser un
  clon de `EQUIV.countries` con los 32 estados de México agregados al inicio).
  Hallazgos:
  - **Faltaba por completo la entrada de Estados Unidos** (`'ESTADOS UNIDOS DE
    AMERICA': 'USA'`) — un cliente nacido en EUA nunca hubiera podido seleccionar
    ese país. Se agregó.
  - 6 entradas correspondían a territorios que SÍ existen en la lista de "países
    visitados" pero NO como opción de `ddlAPP_POB_CNTRY`: Bonaire, Guadalupe,
    Guayana Francesa, Isla Saba, Martinica, Reunión, San Eustaquio. Se eliminaron
    de `paisRegion` (se quedan intactas en `EQUIV.countries`, que es donde sí
    corresponden).
  - Se agregaron 2 entradas menores presentes en el DOM real pero ausentes en la
    tabla: Hong Kong BNO (`HOKO`) y San Bartolomé (`STBR`).
  - Los 32 estados de México ya coincidían correctamente en código (solo difieren
    en el texto de la etiqueta, que no afecta el llenado — se usa por código).
  - Verificación hecha comparando el dump completo del DOM contra la tabla,
    código por código (mismo método que destapó el bug MXN/MEX de v1.11.2).
- **Decisión de negocio confirmada con el usuario** (`AskUserQuestion`): si la IA
  no está segura del país/estado a partir de `birthCity`/`birthState`, se deja el
  campo sin seleccionar y se avisa en el panel — mismo patrón que traducción e
  identificación de países visitados, en vez de asumir México por defecto.
- **Implementación**: nueva función `matchBirthPlaceWithAI(birthCity, birthState)`
  en `popup.js`, mismo patrón que `matchCountriesWithAI()` (Claude Haiku, API key
  real, prompt con lista `CODE::NOMBRE` de `EQUIV.paisRegion`). Se integró en
  `processPDF()`: solo corre si `data.birthCountryRegion` viene vacío (el PDF no
  trajo el campo) y hay al menos city o state; si la IA da un código, sobrescribe
  `data.birthCountryRegion`, si no, se deja vacío y se agrega un aviso ámbar.
- **Renombrado interno**: la variable `data.nationality` (usada para el lugar de
  nacimiento, nombre confuso que databa de antes de que existiera la nacionalidad
  real de PI2, siempre hardcodeada a `MEX`) se renombró a `data.birthCountryRegion`
  en `popup.js` y `content.js` para mayor claridad — sin cambio de comportamiento.
- Versión: 1.12.0 → **1.13.0** (funcionalidad nueva → MINOR).

### v1.13.1 — 2026-08-11 — Bug: IA de lugar de nacimiento nunca se disparaba
- **Reporte del usuario**: probó con un PDF real (`PI1_ESTADO_NACIMIENTO_SOLICITANTE:
  "Nuevo Leon"`) y el select de país/región de nacimiento quedó vacío en el DS-160.
- **Causa raíz** (vista en consola): el PDF sí trae `PI1_PAIS_REGION_SOLICITANTE`,
  pero con el valor genérico `"Mexico"` (no un estado). `EQUIV.paisRegion` no tiene
  una entrada plana `"MEXICO"` a propósito (el select real tampoco la tiene, solo
  `"MEXICO - <ESTADO>"`), así que `processField` no encuentra equivalencia y —
  como es su comportamiento estándar — devuelve el texto crudo `"Mexico"` sin
  resolver, en vez de dejarlo vacío. La condición `needsBirthPlace` de v1.13.0
  solo revisaba si `data.birthCountryRegion` estaba vacío, así que un string no
  vacío pero inválido (`"Mexico"`) hacía que la condición diera `false` y la IA
  nunca se ejecutara. El valor crudo `"Mexico"` llegaba tal cual a
  `fillSelect(ddlAPP_POB_CNTRY, "Mexico")`, que fallaba en silencio porque ningún
  `<option>` tiene ese `value`.
- Fix: la condición ahora verifica si `data.birthCountryRegion` es un **código
  válido** de `EQUIV.paisRegion` (`Object.values(EQUIV.paisRegion)` como `Set`),
  no simplemente si no está vacío. Así, tanto el caso "campo vacío" como el caso
  "campo con texto sin resolver" disparan correctamente el matching por IA usando
  `birthCity`/`birthState`.
- Versión: 1.13.0 → **1.13.1** (bug fix → PATCH).

### v1.14.0 — 2026-08-11 — Lugar de nacimiento de la pareja: misma identificación con IA
- **Pedido del usuario**: lo mismo para `ddlSpousePOBCountry` (país de nacimiento de
  la pareja, sección Pareja), usando `tbxSpousePOBCity` para que la IA lo infiera.
- **Verificación contra el DOM real primero** (mismo método que PI1): se pidió el
  dump de `ddlSpousePOBCountry` y resultó ser **exactamente el mismo select** que
  `ddlAPP_POB_CNTRY` (mismas ~280 opciones, incluye el desglose de 32 estados de
  México). Esto confirmó que `PAREJA_PAIS` con `equiv: 'paisRegion'` en
  `mappings.js` ya estaba correctamente mapeado — no había bug de tabla aquí,
  a diferencia de PI1.
- Sí existe el mismo problema estructural que motivó el fix de v1.13.1: el PDF de
  VisasPro trae `PAREJA_PAIS` con un valor genérico como `"Mexico"` (sin estado),
  que no tiene equivalencia directa y llega sin resolver a `fillSelect`.
- **Implementación**: se reutiliza `matchBirthPlaceWithAI()` tal cual (mismo
  `EQUIV.paisRegion`, mismo prompt) — no hizo falta código nuevo. Se llama con
  `spouseBirthCity` y `null` de estado (el PDF no trae un estado de nacimiento
  separado para la pareja). Se dispara solo si `data.spouseBirthCountry` no es ya
  un código válido de la tabla (mismo chequeo `validBirthPlaceCodes` que v1.13.1,
  reutilizado). Aviso ámbar propio si la IA no tiene certeza o falla.
- Versión: 1.13.1 → **1.14.0** (funcionalidad nueva → MINOR).

### v1.14.1 — 2026-08-11 — Bug: Seguridad Parte 4 solo marcaba 2 de 5 preguntas
- **Reporte del usuario**: al llegar a la Parte 4 de Seguridad, no se llenaba
  correctamente (task #14 del recorrido de las 14 secciones, iniciado).
- **Verificación contra el DOM real**: se pidió el dump de todos los grupos de
  radio button presentes en esa pantalla. Resultado: 5 grupos reales
  (`rblRemovalHearing`, `rblImmigrationFraud`, `rblFailToAttend`,
  `rblVisaViolation`, `rblDeport`), pero `SECURITY_PARTS[3]` en `content.js` solo
  tenía mapeados `rblImmigrationFraud` y `rblDeport` — faltaban 3 de las 5
  preguntas (`rblRemovalHearing`, `rblFailToAttend`, `rblVisaViolation`), que se
  quedaban sin responder y probablemente bloqueaban el "Next" por validación.
- Fix: se completó el arreglo con los 5 grupos reales, en el orden del DOM.
- Versión: 1.14.0 → **1.14.1** (bug fix → PATCH).

### v1.14.2 — 2026-08-11 — Bug: Seguridad Parte 5 solo marcaba 3 de 4 preguntas
- Mismo patrón que v1.14.1, encontrado igual vía dump del DOM real: la Parte 5
  real tiene 4 grupos (`rblChildCustody`, `rblVotingViolation`, `rblRenounceExp`,
  `rblAttWoReimb`), pero `SECURITY_PARTS[4]` solo tenía 3 — faltaba
  `rblAttWoReimb`. Se completó el arreglo.
- Versión: 1.14.1 → **1.14.2** (bug fix → PATCH).

### v1.15.0 — 2026-08-11 — Portada del PDF de revisión: ID de solicitud + leyenda
- **Pedido del usuario**: en `generateReviewPDF()` (botón "📄 Generar PDF de
  Revisión"), agregar 2 cosas a la portada:
  1. El ID de solicitud DS-160 (`#ctl00_lblAppID`, visible en el encabezado del
     master page de CEAC en cualquier pantalla del formulario).
  2. Una leyenda indicando que el documento no es una visa y es solo para fines
     de revisión de datos.
- **Implementación** (`content.js`, dentro de `generateReviewPDF`):
  - `const appId = document.getElementById('ctl00_lblAppID')?.textContent?.trim()
    || 'N/D';` — se lee del documento actual (la pantalla donde se dio clic al
    botón), no de las páginas de revisión que se traen por `fetch()`.
  - Portada: se agregó `<p class="vp-app-id">ID de Solicitud DS-160:
    <strong>${appId}</strong></p>` justo debajo del nombre del cliente.
  - Se agregó un recuadro `.vp-disclaimer` (estilo ámbar, mismo lenguaje visual
    que los avisos del panel) con el texto ampliado: aclara que no es un
    documento oficial ni tiene validez migratoria, que es solo para verificar
    datos antes de la cita consular, y que no sustituye la confirmación oficial
    del Departamento de Estado de EE. UU.
- Versión: 1.14.2 → **1.15.0** (funcionalidad nueva → MINOR).

### v1.15.1 — 2026-08-25 — Bug: extracción con Claude Vision ignoraba media docena de secciones del PDF
- **Reporte del usuario**: al subir un PDF de "Información para llenado" con
  datos de trabajo anterior y estudios, esas dos secciones no se llenaban en
  el formulario CEAC, pese a que el PDF sí las traía completas.
- **Causa raíz**: el prompt de `extractWithClaudeVision()` en `popup.js`
  (bloque "Usa exactamente estos nombres de campo...") es una lista blanca de
  claves que Claude Vision tiene permitido devolver. Esa lista quedó truncada
  en `WET_PRESENT_ACTIVIDADES` (trabajo actual) — nunca se completó al agregar
  las secciones posteriores del PDF, aunque `content.js` (fill) y
  `mappings.js` (`FIELD_RULES`) sí tenían el soporte completo para esos campos
  desde antes. Como el modelo solo devuelve claves de la lista, todo lo que
  venía después se perdía en silencio, sin error visible.
- **Alcance real del bug** (no solo trabajo anterior/estudios, que fue lo que
  se notó porque en este PDF venían con datos): también faltaban
  `TRA_DIRECCION_PAGA_VIAJE_*` (domicilio de quien paga el viaje), toda la
  sección `PUST_*` (viajes previos a EUA / visa previa / robo o extravío /
  rechazo), `PAS_EXTRAVIO_NUM`/`PAS_EXTRAVIO_EXP` (robo de pasaporte),
  `CONTUSA_HOTEL`, `FAM_DIRECTA_*` (familiar directo en EUA), toda la sección
  `PAREJA_*`, y toda la sección `ADD_*` (idiomas, países visitados).
- **Fix**: se completó la lista blanca del prompt con las ~50 claves
  faltantes, agrupadas y ordenadas siguiendo el orden de las secciones del
  PDF. Se verificó por diff contra cada `p('...')`/`r('...')` usado en
  `buildData()` (popup.js) que ahora no falta ninguna clave real (las únicas
  claves del prompt sin consumidor downstream, `DIR_PAIS` y
  `PAS_EMISION_PAIS`, ya estaban así desde antes y no son parte de este bug).
- Versión: 1.15.0 → **1.15.1** (bug fix → PATCH).

### v1.16.0 — 2026-08-25 — Español por defecto como Idioma 1
- **Pedido del usuario**: en la sección "Información Adicional" (idiomas), VisasPro
  siempre reporta español como Idioma 1 en el DS-160. Si el PDF del cliente no
  trae español en ninguno de los 3 espacios de idiomas, la extensión debe
  agregarlo por defecto; si el PDF ya lo trae, se debe dejar tal cual vino.
- **Caso borde resuelto con el usuario**: si el PDF trae otros idiomas pero
  ninguno es español (ej. Idioma1=Inglés, Idioma2=Francés), se antepone
  "Spanish" como Idioma 1 y los que ya venían se recorren un lugar
  (Idioma1→2, Idioma2→3); si ya había 3 idiomas, el que sobra del 3er lugar
  se descarta. No se pierde ningún idioma que el aplicante sí reportó.
- **Implementación** (`popup.js`):
  - `isSpanishLanguage(lang)`: normaliza el string (NFD + strip de acentos,
    igual que el resto del archivo) y detecta si empieza con "ESPANOL" o
    "SPANISH" — cubre tanto el valor traducido al inglés (flujo normal, tras
    `translateFields()`) como el crudo en español (si la traducción falló por
    falta de API key, o en el flujo de "🔄 Re-procesar con Claude Vision",
    que no traduce).
  - `applyDefaultSpanishLanguage(data)`: arma `[language1, language2,
    language3].filter(Boolean)`; si ninguno pasa `isSpanishLanguage`, antepone
    `'Spanish'` y recorta a 3 con `.slice(0, 3)`. Si ya hay español en
    cualquiera de los 3, no hace nada.
  - Se llama en `processPDF()` justo después del bloque de traducción (para
    operar siempre sobre el valor final en inglés), y en el handler de
    `btn-reprocess` justo después de `buildClientData()` (ese flujo no
    traduce, así que opera sobre el valor crudo del PDF).
- Versión: 1.15.1 → **1.16.0** (mejora sobre funcionalidad existente → MINOR).

### v1.17.0 — 2026-09-01 — Pantalla inicial con 2 flujos + PDF de Revisión accesible sin extraer datos
- **Pedido del usuario**: al abrir la extensión, mostrar primero una pantalla con 2
  botones: "Llenar formulario DS-160" (el flujo completo ya existente) y "Llenar
  Sistema de Citas" (aún sin funcionalidad — botón deshabilitado, "próximamente";
  pendiente de que el usuario describa qué debe hacer). Además, mover/duplicar el
  botón "📄 Generar PDF de Revisión" al Paso 1 (pantalla de carga de PDF), porque a
  veces solo se necesita exportar el PDF de revisión sin cargar/extraer el PDF del
  cliente (y la extracción a veces falla).
- **Implementación**:
  - `popup.html`: nuevo `#home-view` (los 2 botones) y `#ds160-view` (envuelve todo
    el flujo existente: Paso 1, alert, client-card). Botón `#btn-home-citas` con
    atributo `disabled` y sin listener — no hace nada, como pidió el usuario.
    Flecha `#btn-back` agregada al header (oculta en home, visible dentro de
    cualquier flujo). Botón `#btn-review-step1` agregado al Paso 1, mismo estilo
    que el `#btn-review` ya existente dentro de la client-card.
  - `popup.js`: función `showView(view)` alterna `#home-view` / `#ds160-view` y la
    flecha de volver. `#btn-home-ds160` → `showView('ds160')`; `#btn-back` →
    `showView('home')`. `#btn-review-step1` llama al mismo `fillSection('review')`
    que ya usaba el botón original. El check de storage al cargar el popup (que
    auto-renderiza la client-card si ya hay un cliente en memoria) ahora también
    hace `showView('ds160')` antes de renderizar, para no dejar esa pantalla
    detrás del home.
  - `content.js`: el listener de `chrome.runtime.onMessage` exigía que existiera
    `visasproClientData` en storage para *cualquier* sección, incluyendo `review`
    — pero `generateReviewPDF()` solo usa `data.firstName`/`data.lastName` para el
    nombre del PDF (todo el contenido lo obtiene en vivo de las páginas de
    revisión de CEAC vía `fetch`). Se agregó una excepción: si la sección es
    `review` y no hay datos, se ejecuta igual con `data = {}` (el nombre del PDF
    cae al fallback ya existente `'Cliente'`). Decisión confirmada con el usuario:
    generarlo igual con nombre genérico en vez de exigir un cliente cargado.
- Versión: 1.16.0 → **1.17.0** (mejora sobre funcionalidad existente → MINOR).

### v1.18.0 — 2026-09-01 — Íconos SVG + rediseño de la pantalla de inicio
- **Pedido del usuario**: reemplazar todos los íconos emoji por SVG, y en la
  pantalla de inicio (los 2 botones agregados en v1.17.0) hacer los botones más
  grandes, del mismo tamaño entre sí, y centrados verticalmente (antes quedaban
  arriba con mucho espacio vacío abajo, porque la extensión corre como side panel
  — que ocupa el alto completo del navegador — y el contenido no llenaba ese alto).
- **Alcance**: se convirtieron los íconos estáticos del HTML (header, carga de
  PDF, botones de sección, diálogo de Claude Vision). Se dejaron tal cual los
  emoji que aparecen dentro de mensajes de texto dinámicos en `popup.js`
  (ej. "⚠️" en notices, "✅"/"❌" en el status de la API key) — son parte de una
  oración, no íconos de UI independientes.
- **Implementación** (`popup.html`):
  - Sprite `<svg style="display:none">` con `<symbol>` reutilizables
    (`icon-settings`, `icon-arrow-left`, `icon-folder`, `icon-edit`,
    `icon-calendar`, `icon-file-text`, `icon-refresh`, estilo outline/stroke a
    24x24), referenciados con `<svg class="icon"><use href="#icon-...">` donde
    antes iba el emoji. Clase `.icon` con `width/height:1em` para que el ícono
    escale con el tamaño de fuente del botón que lo contiene (excepto donde se
    fija un tamaño explícito, como el ícono de carga de PDF).
  - `body` pasó a `display:flex; flex-direction:column; min-height:100vh` (antes
    sin altura definida) para que `.body` (`flex:1`) reparta el alto disponible
    del side panel entre `#home-view`/`#ds160-view`, y el `.footer` quede fijo
    abajo.
  - Botones de inicio: nueva clase `.home-btn` (antes reutilizaban `.btn-section`)
    con `min-height:108px`, ícono + label en columna, y `#home-view` con
    `flex:1; justify-content:center` para centrarlos verticalmente en el alto
    disponible. Se unificó el markup de ambos botones (ícono + label +
    subtítulo opcional) para que midan lo mismo aunque uno tenga una línea
    "Próximamente" y el otro no.
  - `popup.js`: se agregó `showView('home')` explícito cuando no hay cliente en
    storage al abrir el popup (antes el texto del header quedaba con el string
    por defecto del HTML, desincronizado del texto que pone `showView()`).
- Versión: 1.17.0 → **1.18.0** (mejora sobre funcionalidad existente → MINOR).

### v1.18.1 — 2026-09-01 — v1.18.0 no fue suficiente: centrado vertical de home no funcionaba
- El usuario probó v1.18.0 (captura de pantalla) y los 2 botones de inicio seguían
  pegados entre sí, angostos, y pegados arriba con espacio vacío abajo — el
  `justify-content:center` de `#home-view` sobre `body { min-height:100vh }` no
  estaba repartiendo el espacio como se esperaba.
- **Causa probable**: `min-height: 100vh` en `body` fija un *mínimo*, no un alto
  real — en el contenedor donde el usuario probó (side panel/ventana de
  inspección de `popup.html`), el cálculo del alto disponible para el `flex:1`
  de `#home-view` no se estaba resolviendo de forma confiable contra ese mínimo.
- **Fix**: `body` pasa de `min-height:100vh` a `height:100vh` (con `height:100dvh`
  como mejora progresiva para contenedores embebidos) + `overflow:hidden`, y
  `.body` (el div) ahora es el que hace scroll internamente
  (`overflow-y:auto; min-height:0` — el `min-height:0` es necesario para que un
  hijo flex con `flex:1` pueda encogerse y activar el scroll en vez de desbordar
  el contenedor). Esto fuerza a que el alto de `body` sea siempre exactamente el
  del viewport real, para que el centrado vertical de `#home-view` sea confiable.
- Además, ajustes visuales pedidos: gap entre los 2 botones 14px → 28px (ya no
  se ven pegados), `#home-view` con `margin: 0 -4px` para que los botones sean
  un poco más anchos, y los botones mismos más grandes (`min-height` 108px →
  140px, ícono 30px → 36px, `font-size` 14px → 15px).
- Versión: 1.18.0 → **1.18.1** (arreglo de un comportamiento que no quedó bien
  en la primera pasada → PATCH).

### v1.18.2 — 2026-09-01 — v1.18.1 tampoco fue suficiente: botones seguían angostos
- El usuario mandó 2 capturas más: los botones de inicio seguían tan angostos
  como antes (mucho aire a los lados) y tan arriba como antes — el cambio de
  v1.18.1 no tuvo ningún efecto visible. Pidió explícitamente que el ancho
  quedara igual al de los elementos del Paso 1 (`.upload-wrapper`,
  `#btn-review-step1`), que sí se ven correctos (ocupan todo el ancho
  disponible dentro del padding de `.body`).
- **Causa real**: `.home-btn` dependía de `align-items: stretch` (el valor por
  defecto de un contenedor flex) para estirarse al ancho de `#home-view` — a
  diferencia de `.upload-wrapper`, que es un `<div>` de bloque normal (ancho
  100% automático, sin depender de flex). Ese stretch de los botones no se
  estaba aplicando de forma confiable en el contexto real donde corre la
  extensión (side panel de Chrome) — mismo problema de fondo con el vertical
  centering, que tampoco se resolvió con `height:100vh`/`100dvh` +
  `overflow:hidden` del intento anterior (que además se revirtió por el riesgo
  de recortar contenido del `ds160-view` si el cálculo de alto fallaba).
- **Fix**: se revirtió `body` a `min-height:100vh` (sin `height`/`dvh`/
  `overflow:hidden`, evita el riesgo de recorte). `.home-btn` ahora tiene
  `width: 100%` explícito — ya no depende de que el stretch de flex funcione,
  se fuerza directo, igual que el ancho automático de `.upload-wrapper`. Para
  que no queden pegados al header, `#home-view` suma `padding-top: 40px` fijo
  (en vez de depender solo de `justify-content:center` sobre un alto que no
  se estaba resolviendo bien) — se mantiene el `justify-content:center` como
  beneficio extra si el side panel real sí tiene alto de sobra, pero ya no es
  el único mecanismo del que depende verse bien.
- Versión: 1.18.1 → **1.18.2** (arreglo de un comportamiento que no quedó bien
  en la segunda pasada tampoco → PATCH).

### v1.18.3 — 2026-09-01 — Más separación entre los 2 botones de inicio
- El usuario confirmó que el ancho ya quedó bien (v1.18.2), pero pidió más
  separación entre los 2 botones — se veían "juntitos" con el `gap` de 28px.
- **Fix**: `gap` de `#home-view` 28px → 48px.
- Versión: 1.18.2 → **1.18.3** (ajuste visual sobre funcionalidad existente →
  MINOR/PATCH menor, se deja como PATCH por ser un ajuste puntual sin cambio
  de comportamiento).

### v1.18.4 — 2026-09-01 — Causa raíz real encontrada: `showView()` pisaba el `display:flex` con un inline style
- El usuario mandó otra captura: seguían pegados pese a subir el `gap` a 48px.
  Pidió explícitamente no seguir iterando a ciegas ("quiero que lo hagas bien
  a la primera"), así que esta vez se verificó con evidencia en vez de
  adivinar: se abrió `popup.html` en Chrome headless (`--headless=new
  --screenshot`) y se midieron los píxeles de la captura con PIL (escaneo de
  columna/fila de color) para ubicar los bordes reales de los 2 botones.
- **Causa raíz confirmada**: `popup.js` → `showView()` hace
  `home-view.style.display = 'block'` cuando la vista es `'home'`. Ese
  **inline style** tiene más especificidad que la regla de la hoja de
  estilos `#home-view { display: flex; ... }`, así que la pisaba por
  completo cada vez que se mostraba la pantalla de inicio (que es siempre al
  abrir la extensión sin cliente cargado). Con `display:block` en vez de
  `flex`, **todas** las propiedades flex (`gap`, `justify-content: center`,
  `flex: 1`) eran no-ops silenciosos — por eso ningún intento de las v1.18.1
  a v1.18.3 tuvo efecto visible, mientras que `width`, `padding` y
  `min-height` (que no dependen de flex) sí se veían bien y hacían parecer
  que "algo" funcionaba.
- **Fix** (1 línea): `popup.js` línea 545 — `'block'` → `'flex'`.
- **Verificación**: se generaron 2 capturas con Chrome headless (una dejando
  correr el HTML/CSS tal cual sin JS, otra ejecutando una copia exacta de
  `showView('home')` ya corregida) — ambas muestran los 2 botones separados
  por el gap completo y centrados verticalmente en el alto disponible, antes
  de reportar el fix como listo.
- Versión: 1.18.3 → **1.18.4** (arreglo de bug real, con causa raíz
  identificada y verificada → PATCH).

### v1.18.5 — 2026-09-01 — Botones de inicio arriba (ya no centrados verticalmente)
- Con el bug de v1.18.4 resuelto, el usuario vio el centrado vertical
  funcionando por primera vez y pidió lo contrario: que los botones queden
  arriba, no centrados en el alto disponible.
- **Fix**: `#home-view` — `justify-content: center` → `flex-start`, se quita
  el `padding-top: 40px` (ya no hace falta; el único margen superior es el
  `padding: 12px` normal de `.body`, igual que el resto de las pantallas).
  Se mantiene `flex: 1` y el `gap: 48px` entre los 2 botones.
- Verificado con la misma captura headless antes de reportarlo.
- Versión: 1.18.4 → **1.18.5** (ajuste de posicionamiento → PATCH).

### v1.18.6 — 2026-09-01 — Gap de los botones de inicio a 24px
- Fix: `#home-view` `gap` 48px → 24px.
- Versión: 1.18.5 → **1.18.6** (ajuste visual → PATCH).

### v1.19.0 — 2026-09-01 — Envío de datos del cliente a ClickUp (Sistema de Citas)
- **Pedido del usuario**: los 17 datos que pide el Sistema de Citas de la visa
  ya vienen en el PDF de VisasPro; en vez de capturarlos dos veces, al extraer
  el PDF la extensión debe permitir elegir el trámite (tarea) correspondiente
  en ClickUp — de una lista filtrada a trámites en progreso y tipo ≠ Adelanto
  — y mandarle ahí los datos que sí puede sacar del PDF, para retomarlos
  después al construir el botón de "Llenar Sistema de Citas".
- **Descubrimiento del esquema real de ClickUp** (con Personal API Token del
  usuario, vía `curl`): Space "VisasPro" → lista "Trámites"
  (`901404424657`). Status nativo `en progreso` = su "InProgress". Campo
  `Trámite` (drop_down, id `975d92aa-...`) = tipo de trámite; su valor en las
  tareas es el **orderindex** de la opción (entero), no el id — "⚡️ Adelanto"
  es orderindex `2` al momento de escribir esto (si se reordenan las opciones
  del drop_down en ClickUp, hay que actualizar `CLICKUP_ADELANTO_ORDERINDEX`
  en `popup.js`). Se detectaron 2 campos que parecían servir pero no aplican:
  `Visa - DS-160 Apellido` (solo 5 letras) + `Visa - DS-160 Año Nac.` (solo
  año) son el trío que usa la página de "Check My Case Status" de CEAC
  (apellido-5-letras + año + Application ID), no el apellido/fecha de
  nacimiento completos.
- **Reglas de negocio confirmadas con el usuario** (así que varios de los 17
  campos originales NO se guardan en ClickUp):
  - País de Nacimiento y País de Residencia: siempre México → no se guardan.
  - Consulado: no se crea campo nuevo, se reutiliza el ya existente
    `Ubicación del CAS` (de lectura, no de escritura, en este paso).
  - Tipo de Visa / Clase de Visa Anterior: siempre B1/B2 → constante fija en
    el código de la extensión (aún no escrita en ningún lado — se usará
    cuando se construya el botón de Citas), no se guarda en ClickUp.
  - Número DS-160: NO se manda en este paso — ya existe el campo
    `Visa - DS-160 ID` en ClickUp, pero ese dato se captura *después*, al
    llenar el DS-160 en CEAC (de donde ya leemos `ctl00_lblAppID` para el PDF
    de Revisión) — pendiente de implementar ese segundo punto de sincronía.
  - Visa previa (sí/no): derivado — "sí" si el PDF trae cualquier dato de
    fecha de emisión de visa previa (`visaIssue_day/month/year`), sin
    necesidad de mirar el número de visa.
- **Custom Fields nuevos creados en la lista real "Trámites" vía API**
  (prefijo `Visa - `, confirmado por el usuario): Nombre(s), Apellido(s),
  Número de Pasaporte, Estado de Residencia (todos `short_text`); Visa Previa
  (`drop_down` Sí/No); Fecha de Emisión Visa Anterior y Fecha de Vencimiento
  Visa Anterior (`date`). Se reutilizan los ya existentes: `Teléfono`,
  `Visa - Correo electrónico`, `Visa - Fecha de Nacimiento`.
- **Campo de PDF que estaba huérfano, ahora conectado**: `mappings.js` ya
  traía `PUST_VISA_PREVIA_V_MES` (mes de vencimiento de la visa previa) con
  su equivalencia, pero `buildClientData()` en `popup.js` nunca lo leía. Se
  agregó `visaExpiry_day/month/year` leyendo `PUST_VISA_PREVIA_V_DIA` /
  `_V_MES` / `_V_ANO` — el día y año son una suposición por convención de
  nombres con el bloque hermano de emisión (`_E_DIA`/`_E_ANO`), **sin
  verificar contra un PDF real todavía**.
- **Implementación**:
  - `manifest.json`: se agregó `https://api.clickup.com/*` a
    `host_permissions`.
  - `popup.html`: input de token de ClickUp en el panel de ⚙️ (mismo patrón
    que la API key de Claude, storage key `vp_clickup_token`); nueva sección
    "Sistema de Citas — ClickUp" dentro de la client-card con un `<select>`
    de trámites y el botón "☁️ Guardar en ClickUp"; ícono SVG nuevo
    `icon-cloud-upload` en el sprite.
  - `popup.js`: `loadTramites()` llena el `<select>` al renderizar la
    client-card, consultando `GET /list/{id}/task?statuses[]=en progreso` y
    filtrando client-side por el orderindex de "Trámite"; el botón de envío
    arma los valores (fechas convertidas a epoch-ms UTC vía `toClickUpDate()`,
    que traduce el código de 3 letras JAN..DEC que ya usa el resto del
    pipeline) y hace un `POST /task/{id}/field/{fieldId}` por cada campo con
    valor (la API de ClickUp v2 no tiene un endpoint de bulk-update).
- **Verificado antes de reportarlo**: se corrió el filtro real contra la
  lista "Trámites" del usuario (11 tareas en "en progreso", 7 excluidas por
  ser Adelanto, quedan 4) — coincide con lo esperado. **No** se probó el
  `POST` de escritura contra una tarea real (para no meter datos sintéticos
  en el trámite real de un cliente) — pendiente que el usuario lo pruebe con
  un caso real desde la extensión y confirme.
- **Pendiente / próximos pasos**: (1) usuario prueba el flujo completo con un
  PDF y trámite reales; (2) verificar que `PUST_VISA_PREVIA_V_DIA`/`_V_ANO`
  sí existen con esos nombres en un PDF real; (3) sincronizar
  `Visa - DS-160 ID` al momento de llenar el DS-160 en CEAC; (4) diseño del
  botón "Llenar Sistema de Citas" en sí (aún sin ninguna acción).
- Versión: 1.18.6 → **1.19.0** (funcionalidad nueva → MINOR).

### v1.19.1 — 2026-09-02 — Errores de ClickUp visibles sin abrir la consola
- El usuario probó el envío real: 8 de 9 campos se guardaron, 1 falló — pero
  la alerta solo decía "1 fallaron (revisa la consola)" sin decir cuál ni por
  qué, y para verlo había que inspeccionar el side panel manualmente.
- **Fix**: `updates` pasó de arreglos `[fieldId, value]` a objetos
  `{label, fieldId, value}`; el `catch` del loop de envío ahora arma
  `${label} (${err.message})` por cada fallo (el mensaje ya trae el status y
  cuerpo de la respuesta de ClickUp, ver `clickUpRequest`) y todos se listan
  directo en la alerta de la extensión. Los campos que se saltan por no traer
  dato del PDF (`value == null`) ya no se cuentan como "fallo" — se listan
  aparte en `console.log` como informativo, no como error.
- Versión: 1.19.0 → **1.19.1** (arreglo de diagnóstico → PATCH).

### v1.19.2 — 2026-09-02 — Bug real: Teléfono rechazado por ClickUp (formato)
- Con el diagnóstico de v1.19.1 el usuario mandó el error exacto: `Value is
  not a valid phone number` (ClickUp `FIELD_016`).
- **Causa raíz**: `data.phone` viene limpio a solo 10 dígitos por
  `CLEAN.phone` en `mappings.js` (pensado para el campo del DS-160, que solo
  quiere el número plano). El campo "Teléfono" de ClickUp es tipo `phone` y
  exige formato con código de país — se confirmó revisando tareas reales
  (`+528182036906`).
- **Fix**: nueva `toClickUpPhone(phone)` en `popup.js` que antepone `+52`
  (México) a los 10 dígitos antes de mandarlos a ClickUp; si no son
  exactamente 10 dígitos, no se envía (mejor omitir que mandar un valor que
  ClickUp va a rechazar igual).
- Versión: 1.19.1 → **1.19.2** (arreglo de bug real → PATCH).

### v1.19.3 — 2026-09-02 — Debug: fecha de vencimiento de visa previa no llegó
- El usuario confirmó que "Fecha de Emisión Visa Anterior" sí se guardó pero
  "Fecha de Vencimiento Visa Anterior" no — consistente con la sospecha ya
  anotada en v1.19.0: `PUST_VISA_PREVIA_V_DIA`/`_V_ANO` eran una suposición
  sin verificar contra un PDF real.
- Se agregó un `console.log` temporal en `processPDF()` que imprime todos los
  campos crudos `PUST_*` del PDF al cargarlo, para ubicar el nombre real del
  campo de vencimiento sin adivinar de nuevo. Pendiente: el usuario carga un
  PDF con visa previa, copia ese log, y se corrige `visaExpiry_day`/`_year`
  en `popup.js` con los nombres reales.
- Versión: 1.19.2 → **1.19.3** (debug para diagnosticar → PATCH).

### v1.20.0 — 2026-09-02 — Número DS-160 se manda a ClickUp desde el mismo botón
- Pendiente explícito desde v1.19.0: el usuario confirmó que quería que el
  mismo botón "Guardar en ClickUp" se lleve también el Número DS-160,
  tomándolo "del sistema" (CEAC) en vez de pedirlo aparte.
- **Implementación**:
  - `content.js`: nueva acción de mensaje `getAppId` en el listener — lee
    `ctl00_lblAppID` del DOM (mismo elemento que ya usa `generateReviewPDF`)
    y responde `{ok:true, appId}` sin pasar por `SECTION_HANDLERS` (no
    necesita `visasproClientData`, es una lectura puntual del DOM).
  - `popup.js`: `getDS160IdFromActiveTab()` hace
    `chrome.tabs.query` + `chrome.tabs.sendMessage({action:'getAppId'})` a la
    pestaña activa; si falla (no es una pestaña de CEAC, no hay content
    script, la solicitud aún no existe) devuelve `null` sin lanzar error. Se
    llama dentro del handler de "Guardar en ClickUp" y el resultado se agrega
    a `updates` con el field id de `Visa - DS-160 ID` (el que ya existía en
    ClickUp) — si es `null` se omite igual que cualquier otro campo sin dato.
  - Diseño: como el `POST` de ClickUp siempre sobreescribe el valor del
    campo, no pasa nada si el usuario manda el trámite primero sin el
    DS-160 (porque aún no lo ha creado en CEAC) y después, ya parado en la
    página de CEAC con la solicitud creada, le da "Guardar en ClickUp" de
    nuevo — el segundo envío sí se lo lleva y actualiza solo ese campo (los
    demás quedan igual porque ya estaban guardados).
- **De paso, el usuario pidió llenar los otros 2 campos del trío de "Check My
  Case Status" de CEAC** que ya existían en ClickUp pero hasta ahora se
  llenaban a mano:
  - `Visa - DS-160 Año Nac.` ← `data.dob_year` tal cual.
  - `Visa - DS-160 Apellido` ← `toClickUpSurname5(data.lastName)`: toma la
    primera palabra de `lastName` (que puede traer los 2 apellidos juntos,
    ej. "GARCIA MALDONADO"), quita acentos vía NFD + `\p{M}` (marcas
    combinantes), y corta a 5 letras en mayúsculas. Probado contra los
    valores reales vistos en ClickUp: "García Maldonado" → "GARCI",
    "Morales Lopez" → "MORAL" — coincide exacto.
- Versión: 1.19.3 → **1.20.0** (funcionalidad nueva → MINOR).

### v1.21.0 — 2026-09-02 — Botón "Llenar Sistema de Citas" habilitado (primera versión)
- **Descubrimiento del formulario real**: el usuario pegó en la consola del
  Sistema de Citas (confirmado: `https://ais.usvisa-info.com/es-mx/niv/schedule/{id}/applicants/new`
  — GDIT/CGI Federal, el sistema oficial de citas de visa) el script de dump
  de campos que se le dio en este mismo hilo. Formulario Rails
  `applicant[...]`, confirma exactamente el mismo listado de consulados (10
  ciudades, mismos value ids 65-74) que ya se había visto en los Custom
  Fields de ClickUp.
- **Reglas de negocio confirmadas con el usuario** para campos que no vienen
  del PDF ni de ClickUp: "¿Viajará para aplicar?" → siempre "No". "Clase de
  visa anterior" → siempre B1/B2 (value `2`), independientemente de si hay
  visa previa (el `<select>` es obligatorio igual). "Número de Petición" →
  sin regla todavía, se deja vacío para llenar a mano (pendiente).
- **Implementación**:
  - `popup.html`: se habilitó `#btn-home-citas` (ya no `disabled`, sin el
    label "Próximamente"); nueva vista `#citas-view` con un `<select>` de
    trámites y el botón "Llenar formulario".
  - `popup.js`: `showView()` soporta la vista `'citas'`. Se generalizó
    `loadTramites()` → `loadTramitesInto(selectId)` (mismo fetch/filtro de
    trámites que ya usaba el flujo de "Guardar en ClickUp", reutilizado para
    ambos selects). `readTramiteFromClickUp(taskId)`: `GET /task/{id}`,
    arma un objeto plano con los custom fields ya guardados —
    `fromClickUpDate()` es el inverso de `toClickUpDate()` (epoch-ms → día/
    mes-código/año). El botón "Llenar formulario" lee el trámite
    seleccionado y manda `{action:'fillCitas', data}` a la pestaña activa.
  - `content-citas.js` (nuevo, corre solo en `ais.usvisa-info.com`): mapea
    cada dato a su campo real del formulario (ids como
    `applicant_first_name`, `applicant_ds160_number`, etc., confirmados con
    el dump). Fechas van a selects separados de Día/Mes/Año en formato
    numérico (a diferencia de DS-160/ClickUp que usan el código de 3 letras
    JAN..DEC — se convierte con `MONTH_CODE_TO_NUM`). "Consulado" hace match
    de texto contra el `<select>` usando el valor de "Ubicación del CAS" de
    ClickUp (con un mapa de alias tipo "CDMX"→"Mexico City" para las
    variantes que no calzan literal). "Estado de Residencia"/"País de
    Residencia" se ubican por el texto de su `<label>` en vez de por id fijo,
    porque son campos `mission_specific_values_attributes][N]` cuyo índice
    puede variar según la misión configurada en el sistema.
  - `manifest.json`: nuevo host permission y bloque de `content_scripts`
    para `https://ais.usvisa-info.com/*`.
- **Sin resolver todavía** (el botón los deja en la lista de "sin llenar" al
  reportar el resultado, no falla por eso): "Número de Petición" (sin regla
  definida), y la fecha de vencimiento de la visa previa (sigue pendiente
  el debug del nombre real del campo en el PDF, ver v1.19.3).
- **No probado end-to-end todavía** — falta que el usuario lo corra contra
  un trámite real con la página del Sistema de Citas abierta y confirme.
- Versión: 1.20.0 → **1.21.0** (funcionalidad nueva → MINOR).

### v1.21.1 — 2026-09-02 — Diagnóstico: llenado no visible + errores por campo aislados
- El usuario probó el llenado real y "no hizo nada" — en la consola del
  Sistema de Citas apareció un error del propio JS del sitio (no del
  content script): `Cannot read properties of null (reading 'autoclose')`
  en un `leaveEventHandler` de un `<li>`. Causa probable: al menos un
  `<select>` del formulario (muy probablemente el de Consulado) está
  "vestido" con un widget JS del sitio que dibuja su propio dropdown con
  `<li>` — al cambiar el valor por código en vez de con clics reales, el
  widget truena en su propia lógica de cierre.
- Aclaración para el usuario: esta pantalla es de una sola página (a
  diferencia del DS-160, que tiene varios pasos con postback) — no hace
  falta el patrón de "continuar tras recargar" que sí usa `content.js` para
  Security.
- **Fix defensivo** (mientras se identifica el campo exacto): en
  `content-citas.js`, cada campo ahora corre en su propio `try/catch`
  dentro de `fillCitas()` (antes solo había un único `try/catch` alrededor
  de toda la función en el listener de mensajes) — si un campo truena, ya
  no le impide al resto llenarse. Se agregó `console.log` por cada campo
  intentado (para ver en la consola exactamente hasta dónde llega) y la
  respuesta ahora incluye `errors` (campo + mensaje) además de `filled`/
  `skipped`, mostrados en la alerta del popup.
- **Pendiente**: el usuario vuelve a probar con esto y comparte qué campo(s)
  aparecen en `errors` para localizar cuál exactamente choca con el widget
  del sitio y ajustar su técnica de llenado (ej. simular clics reales en
  vez de solo cambiar `.value`, si el problema persiste ahí).
- Versión: 1.21.0 → **1.21.1** (arreglo de diagnóstico + robustez → PATCH).

### v1.21.2 — 2026-09-02 — Bug real: el `#alert` vivía dentro de `#ds160-view`
- El usuario probó otra vez: "no hace nada, ni siquiera sale el mensaje de
  error que me decía" — ni el mensaje de éxito/error de la extensión
  aparecía al usar el botón de Citas.
- **Causa raíz**: `<div id="alert">` estaba anidado dentro de `#ds160-view`
  (usado únicamente por el flujo del DS-160). `showView('citas')` pone
  `#ds160-view` en `display:none` — así que aunque `showAlert()` seguía
  poniendo correctamente `#alert` en `display:block`, el div quedaba
  invisible igual porque su contenedor padre estaba oculto. No era un bug
  del llenado en sí (ese seguía corriendo, solo que su resultado nunca se
  veía en pantalla estando en Citas).
- **Fix**: se movió `#alert` a un nivel compartido por las 3 pantallas
  (justo después de abrir `.body`, antes de `#home-view`/`#citas-view`/
  `#ds160-view`), en vez de vivir dentro de una vista específica.
- Versión: 1.21.1 → **1.21.2** (arreglo de bug real → PATCH).

### v1.21.3 — 2026-09-02 — Consulado fijo a Monterrey, espaciado y alerta autoocultable
- El usuario probó el llenado real: 26 campos llenados, solo faltaron
  Consulado (sin dato de "Ubicación del CAS" en la tarea de prueba) y
  Número de Petición (esperado, sin regla). País de Residencia Permanente y
  País de Residencia sí estaban entre los 26 (ya se llenaban con México
  desde v1.21.0) — el usuario los volvió a pedir, se confirma que ya
  estaban cubiertos, no fue necesario tocar código ahí.
- 3 ajustes pedidos:
  1. **Consulado siempre Monterrey**: se reemplazó la búsqueda por texto
     contra "Ubicación del CAS" de ClickUp (`setSelectByOptionText` +
     `normalizeCity`, ya removidos) por un valor fijo `CONSULADO_MONTERREY
     = '71'` en `content-citas.js` — más simple y ya no depende de que ese
     dato exista en ClickUp.
  2. **Espacio entre la alerta y la lista de trámites**: `.alert` no tenía
     `margin-bottom` — se agregó `margin-bottom: 12px`.
  3. **La alerta se quedaba pegada en pantalla** al navegar de vuelta al
     home (capturado en pantalla por el usuario) — porque `#alert` es
     compartido entre las 3 vistas (desde el fix de v1.21.2) y solo se
     ocultaba manualmente en puntos específicos del flujo del DS-160.
     `showAlert()` ahora arma un `setTimeout` de 5s que la oculta sola
     (limpiando cualquier timeout anterior si se dispara otra alerta antes).
- Versión: 1.21.2 → **1.21.3** (ajustes + un bug real → PATCH).

### v1.21.4 — 2026-09-02 — Bug real: "País de Residencia" le pisaba el valor a "País de Residencia Permanente"
- El usuario probó con XPath directo sobre el DOM: ni
  `applicant_permanent_residency_country_code` ni
  `applicant_mission_specific_values_attributes_1_value` (País de
  Residencia) quedaban en México.
- **Causa raíz**: `setByLabel()` usaba `startsWith` para ubicar la etiqueta.
  La etiqueta "País de Residencia Permanente*" también empieza con "País de
  Residencia", y aparece ANTES en el formulario que la etiqueta real "País
  de Residencia*" — así que `Array.find` siempre agarraba la etiqueta
  equivocada (la del `<select>` de Permanente). El código entonces intentaba
  poner `el.value = "México"` sobre ese `<select>` (cuyas opciones son
  códigos tipo `mx`, no el nombre) — en un `<select>`, asignar un value que
  no calza con ninguna `<option>` no truena, simplemente deja el select sin
  selección — **pisando** el `'mx'` correcto que la llamada anterior
  (`setValue('applicant_permanent_residency_country_code', 'mx')`) ya le
  había puesto. El campo de texto real (`mission_specific_values...[1]`)
  nunca llegó a tocarse.
- **Fix**: `setByLabel()` ahora exige coincidencia EXACTA del texto de la
  etiqueta (sin el asterisco de obligatorio), no "empieza con" — se
  verificó la lógica con un test aislado antes de reportarlo (confirma que
  distingue "País de Residencia" de "País de Residencia Permanente"). De
  paso, `setValue()`/`setRadio()`/`setByLabel()` ahora verifican que el
  valor realmente haya quedado puesto (comparando `el.value` después de la
  asignación) en vez de asumir éxito solo porque no hubo excepción — así se
  detectó este bug y evita falsos positivos futuros.
- Además, el usuario pidió que el campo de texto libre quede en mayúsculas
  sin acento: `'México'` → `'MEXICO'`.
- Versión: 1.21.3 → **1.21.4** (arreglo de bug real → PATCH).

### v1.22.0 — 2026-09-02 — Rediseño de la pantalla del DS-160
- Pedido del usuario, varios cambios de interfaz sobre la vista del DS-160:
  1. **Header**: título "VisasPro DS-160" → solo "VisasPro"; se quitó el
     recuadro rojo "VP" (ya no aparece en ninguna vista, era compartido).
     El texto de abajo del título ahora hace match exacto con la etiqueta
     del botón de inicio al que se entró ("Llenar formulario DS-160" /
     "Llenar Sistema de Citas"), antes decía otra cosa que no correspondía.
  2. **Tarjeta de cliente**: se quitó el CURP (debajo del nombre) y el
     bloque de 4 datos (Nacimiento, Género, Estado Civil, Pasaporte) —
     `renderClientCard()` ya no llena esos elementos, se quitaron del HTML
     y su CSS (`.data-grid`, `.data-item`) por quedar sin uso.
  3. **3 botones reorganizados y agrandados**: "Generar PDF de Revisión"
     (ya no vive dentro de la grilla de Secciones DS-160), "Re-procesar con
     Claude Vision" y "Limpiar y cargar otro cliente" (ambos ya no viven
     abajo del todo) se movieron juntos arriba, justo debajo del nombre del
     cliente, uno al lado del otro en una fila de 3. Nueva clase
     `.action-btn` (icono arriba + texto abajo, mismo lenguaje visual que
     `.home-btn` del inicio pero more compacta para caber 3 en una fila) —
     `.action-btn-primary` (PDF Revisión, oscuro), `.action-btn-danger`
     (Reprocesar, rojo claro, mismo tono que ya tenía), y la variante base
     (Limpiar). Etiquetas acortadas para que quepan en el botón chico
     ("PDF Revisión", "Reprocesar", "Limpiar"), con el texto completo
     original como `title` (tooltip). Nuevo ícono SVG `icon-trash` en el
     sprite para Limpiar.
  4. **Más espacio antes de "Sistema de Citas — ClickUp"**: el `<div
     class="divider">` que la separa de "Secciones DS-160" pasó de
     `margin: 0 12px` (heredado, sin margen vertical) a `margin: 16px 12px`.
- Verificado con una captura headless renderizando la tarjeta con datos de
  prueba antes de reportarlo.
- Versión: 1.21.4 → **1.22.0** (rediseño de interfaz → MINOR).

### v1.22.1 — 2026-09-02 — Los 3 botones de acción, debajo de Secciones DS-160
- El usuario pidió mover los 3 botones (PDF Revisión/Reprocesar/Limpiar) de
  arriba del nombre del cliente a debajo de toda la grilla de Secciones
  DS-160, manteniendo el mismo tamaño/diseño de v1.22.0.
- Fix: se reordenó el `.action-row` en el HTML, ahora entre el `.sections`
  de Secciones DS-160 y el divider que lleva a Sistema de Citas — ClickUp.
- Versión: 1.22.0 → **1.22.1** (ajuste de layout → PATCH).

### v1.22.2 — 2026-09-02 — Sección de ClickUp: título y botón rediseñados
- Pedido del usuario: título de la sección "Sistema de Citas — ClickUp" →
  "Cargar información a ClickUp"; el botón "Guardar en ClickUp" pasa del
  estilo de barra delgada (`.btn-section full`) al mismo lenguaje visual
  que los 3 botones de arriba (ícono arriba, texto abajo, tarjeta
  redondeada), pero de ancho completo — nuevo modificador `.action-btn.full`
  (`width:100%`, algo más alto y con texto más grande que las variantes de
  3-en-fila, ya que no compite por espacio).
- Verificado con captura headless antes de reportarlo.
- Versión: 1.22.1 → **1.22.2** (ajuste de interfaz → PATCH).

### v1.23.0 — 2026-09-02 — Configuración pasa a ser una vista más
- Pedido del usuario: en la vista de Citas, título "Trámites en Progreso" →
  "Información de Cliente", y el botón "Llenar formulario" pasa del estilo
  de barra delgada al mismo lenguaje visual `.action-btn.full` que ya se usa
  en "Guardar en ClickUp". Además, el panel de Configuración (⚙️) se veía
  "flotando" encima de la vista actual porque vivía fuera de `.body`, entre
  el header y el resto — se pidió que fuera una vista independiente con su
  propia flecha de volver, como las demás, y que sus botones seleccionaran
  el mismo diseño ya establecido.
- **Implementación**:
  - `popup.html`: el contenido de `#settings-panel` se movió a un nuevo
    `#settings-view` dentro de `.body`, hermano de home/ds160/citas-view.
    Los pares Guardar/Borrar (API Key de Claude y Token de ClickUp) ahora
    son `.action-row` de 2 `.action-btn` (Guardar = `action-btn-primary`
    con ícono de check nuevo `icon-check`; Borrar = variante base con
    `icon-trash`). Nuevo modificador `.action-row.flush` (sin el padding
    horizontal de 12px que trae `.action-row` por defecto) para usarlo
    dentro de vistas de nivel superior que ya traen su propio padding
    (`.body`), a diferencia de `.client-card` que no tiene padding propio.
  - `popup.js`: `showView()` ahora soporta `'settings'` (con su propio
    texto de header "Configuración"). Nueva variable `lastMainView` que
    recuerda la última vista principal (home/ds160/citas) — la flecha de
    volver, al salir de Configuración, regresa ahí en vez de siempre a home.
    El botón ⚙️ ya no alterna un `display` a mano, llama a `showView('settings')`.
- Verificado con 2 capturas headless (Configuración y la vista de Citas
  actualizada) antes de reportarlo.
- Versión: 1.22.2 → **1.23.0** (funcionalidad de navegación nueva → MINOR).
