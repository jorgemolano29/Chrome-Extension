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
