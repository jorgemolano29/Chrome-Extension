import * as pdfjsLib from './lib/pdf.min.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.mjs');

// ── Renderizar PDF a imágenes JPEG en escala de grises ────
async function pdfToImages(buffer, dpi = 150, quality = 0.85) {
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;
  const scale = dpi / 72; // PDF nativo es 72 DPI

  const images = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');

    // Fondo blanco
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: ctx, viewport }).promise;

    // Convertir a escala de grises
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let j = 0; j < data.length; j += 4) {
      const gray = data[j] * 0.299 + data[j + 1] * 0.587 + data[j + 2] * 0.114;
      data[j] = data[j + 1] = data[j + 2] = gray;
    }
    ctx.putImageData(imageData, 0, 0);

    // Exportar como JPEG
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    const base64 = dataUrl.split(',')[1];
    images.push(base64);
    console.log(`[VP] Página ${i}/${pdf.numPages} renderizada (${Math.round(base64.length / 1024)} KB)`);
  }

  return images;
}

// ════════════════════════════════════════════════════════
//  VISASPRO — POPUP.JS  v1.15.0
// ════════════════════════════════════════════════════════

// La API key real se lee de chrome.storage.local ('vp_api_key', configurada en ⚙️).
// Antes había una constante hardcodeada con un placeholder inválido que translateFields()
// usaba en vez de la key guardada — la traducción fallaba en silencio (ver
// CONTEXTO_PROYECTO.md, v1.5.1).


// ── Parser PDF ──────────────────────────────────────────

function parsePDFFields(buffer) {
  const bytes = new Uint8Array(buffer);
  let pdf = '';
  for (let i = 0; i < bytes.length; i++) pdf += String.fromCharCode(bytes[i]);

  const objIndex = {};
  const objRe = /(\d+)\s+0\s+obj\s*([\s\S]*?)\s*endobj/g;
  let m;
  while ((m = objRe.exec(pdf)) !== null) objIndex[m[1]] = m[2];

  function decodePDFString(s) {
    // Cadenas con acentos (ñ, á, é...) vienen en UTF-16BE con BOM (FE FF + 2 bytes
    // por carácter). Si no se decodifican, el BOM sobrevive a la limpieza de acentos
    // como una "Y" espuria al inicio del valor (ver CONTEXTO_PROYECTO.md).
    if (s.charCodeAt(0) === 0xFE && s.charCodeAt(1) === 0xFF) {
      // El PDF escapa "(" ")" "\" con una barra invertida aunque el texto esté en
      // UTF-16BE (son delimitadores de cadena para el propio formato PDF, no del
      // encoding). Hay que quitar esos escapes ANTES de reagrupar bytes de a 2 en 2,
      // si no la barra invertida desalinea el resto de la cadena (ej. "Día(s)" nunca
      // decodificaba bien por los paréntesis — ver CONTEXTO_PROYECTO.md).
      const unescaped = s
        .replace(/\\(\d{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
        .replace(/\\\(/g, '(').replace(/\\\)/g, ')').replace(/\\\\/g, '\\');
      let out = '';
      for (let i = 2; i < unescaped.length - 1; i += 2) {
        out += String.fromCharCode((unescaped.charCodeAt(i) << 8) | unescaped.charCodeAt(i + 1));
      }
      return out.replace(/\s+/g, ' ').trim();
    }
    return s
      .replace(/\\(\d{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
      .replace(/\\n/g, '\n').replace(/\\r/g, '').replace(/\\t/g, '\t')
      .replace(/\\\\/g, '\\').replace(/\\\(/g, '(').replace(/\\\)/g, ')')
      .replace(/\s+/g, ' ').trim();
  }

  function parseDict(str) {
    const result = {};
    const tMatch = str.match(/\/T\s*\(([^)]*)\)/);
    if (tMatch) result.T = decodePDFString(tMatch[1]);
    const vStrMatch = str.match(/\/V\s*\(((?:[^)(\\]|\\.|\([^)]*\))*)\)/);
    const vNameMatch = str.match(/\/V\s*\/([^\s\/\[<()\]]+)/);
    if (vStrMatch) result.V = decodePDFString(vStrMatch[1]);
    else if (vNameMatch && vNameMatch[1] !== 'Off') result.V = vNameMatch[1];
    const parentMatch = str.match(/\/Parent\s+(\d+)\s+0\s+R/);
    if (parentMatch) result.parentId = parentMatch[1];
    return result;
  }

  const fields = {};
  for (const [, body] of Object.entries(objIndex)) {
    if (!body.includes('/Widget')) continue;
    const obj = parseDict(body);
    if (obj.T && obj.V && obj.V !== 'no aplica') { fields[obj.T] = obj.V; continue; }
    if (!obj.T && obj.parentId && objIndex[obj.parentId]) {
      const parent = parseDict(objIndex[obj.parentId]);
      if (parent.T && parent.V && parent.V !== 'no aplica') fields[parent.T] = parent.V;
    }
  }
  console.log('[VisasPro] Campos extraídos del PDF:', fields);
  return fields;
}


// ── Traducción automática ES→EN via Claude API ───────────

async function translateFields(fieldsToTranslate) {
  if (!fieldsToTranslate || Object.keys(fieldsToTranslate).length === 0) {
    return { translated: {}, ok: true };
  }

  const { vp_api_key: apiKey } = await chrome.storage.local.get('vp_api_key');
  if (!apiKey) {
    console.warn('[VisasPro] No hay API key configurada — se omite la traducción, quedan los textos en español.');
    return { translated: fieldsToTranslate, ok: false, reason: 'no-api-key' };
  }

  const prompt = [
    'You are translating fields from a Mexican visa application form from Spanish to English.',
    'Translate each value accurately and concisely. Keep proper nouns as-is.',
    'Respond ONLY with a valid JSON object mapping the same keys to their English translations.',
    'Do not include any explanation, markdown, or extra text.',
    '',
    'Fields to translate:',
    JSON.stringify(fieldsToTranslate, null, 2),
  ].join('\n');

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(`API error ${response.status}: ${err?.error?.message || 'desconocido'}`);
    }
    const data = await response.json();
    const raw = data.content?.[0]?.text || '{}';
    const translated = JSON.parse(raw.replace(/```json|```/g, '').trim());
    console.log('[VisasPro] Traducciones obtenidas:', translated);
    return { translated, ok: true };
  } catch (err) {
    console.error('[VisasPro] Error en traducción:', err);
    return { translated: fieldsToTranslate, ok: false, reason: err.message }; // fallback: devolver originales
  }
}


// ── Matching de países (Adicional → países visitados) via Claude ────────
//  A diferencia de idiomas (traducción libre), aquí el problema es matching contra
//  una lista CERRADA de ~190 opciones válidas del DS-160 (EQUIV.countries en
//  mappings.js) — el PDF puede traer variantes ("EEUU", "Holanda" en vez de "Países
//  Bajos", etc.) que la tabla fija no cubre. Se le pasa a Claude el texto crudo +
//  la lista completa de opciones válidas, y se le pide el código exacto. Decisión del
//  usuario, 2026-08-11 — ver CONTEXTO_PROYECTO.md.

async function matchCountriesWithAI(rawCountries) {
  const entries = Object.entries(rawCountries).filter(([, v]) => v && v.trim());
  if (entries.length === 0) return { matched: {}, ok: true };

  const { vp_api_key: apiKey } = await chrome.storage.local.get('vp_api_key');
  if (!apiKey) {
    console.warn('[VisasPro] No hay API key configurada — se omite el matching de países con IA, se usa la tabla fija.');
    return { matched: {}, ok: false, reason: 'no-api-key' };
  }

  const validOptions = Object.entries(EQUIV.countries)
    .map(([name, code]) => `${code}::${name}`)
    .join('\n');

  const prompt = [
    'You are matching country names extracted from a Mexican visa application PDF',
    'to the exact country code accepted by the DS-160 visa form dropdown.',
    'The input text may be misspelled, abbreviated, or use an alternate/informal name',
    '(e.g. "EEUU" for the United States, "Holanda" for "Países Bajos").',
    'Below is the list of VALID options, one per line, in the format CODE::NAME.',
    'For each input field, return the CODE of the single best matching option.',
    'If you are not reasonably confident of a match, return null for that field.',
    'Respond ONLY with a valid JSON object mapping the same keys to the matched code',
    '(or null). Do not include any explanation, markdown, or extra text.',
    '',
    'Valid options:',
    validOptions,
    '',
    'Fields to match:',
    JSON.stringify(Object.fromEntries(entries), null, 2),
  ].join('\n');

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(`API error ${response.status}: ${err?.error?.message || 'desconocido'}`);
    }
    const data = await response.json();
    const raw = data.content?.[0]?.text || '{}';
    const matched = JSON.parse(raw.replace(/```json|```/g, '').trim());
    console.log('[VisasPro] Países emparejados con IA:', matched);
    return { matched, ok: true };
  } catch (err) {
    console.error('[VisasPro] Error en matching de países:', err);
    return { matched: {}, ok: false, reason: err.message }; // fallback: se usa la tabla fija ya calculada
  }
}


// ── Identificación de lugar de nacimiento (PI1 → ddlAPP_POB_CNTRY) via Claude ──
//  El campo PDF PI1_PAIS_REGION_SOLICITANTE no siempre viene en el PDF de VisasPro.
//  Cuando falta, se usa birthCity + birthState (que el PDF sí trae) para que la IA
//  determine la opción correcta de la lista cerrada de EQUIV.paisRegion (32 estados
//  de México + resto de países del mundo — el select real del DS-160 mezcla ambos).
//  Si no está segura, se deja el campo sin seleccionar y se avisa. Decisión del
//  usuario, 2026-08-11 — ver CONTEXTO_PROYECTO.md.

async function matchBirthPlaceWithAI(birthCity, birthState) {
  const hasData = (birthCity && birthCity.trim()) || (birthState && birthState.trim());
  if (!hasData) return { code: null, ok: true };

  const { vp_api_key: apiKey } = await chrome.storage.local.get('vp_api_key');
  if (!apiKey) {
    console.warn('[VisasPro] No hay API key configurada — se omite la identificación del lugar de nacimiento con IA.');
    return { code: null, ok: false, reason: 'no-api-key' };
  }

  const validOptions = Object.entries(EQUIV.paisRegion)
    .map(([name, code]) => `${code}::${name}`)
    .join('\n');

  const prompt = [
    'You are determining the place of birth (country, or Mexican state if born in Mexico)',
    'of an applicant on a Mexican visa application, for the DS-160 visa form dropdown.',
    'Below is the list of VALID options, one per line, in the format CODE::NAME.',
    'Mexican options are state-level ("Mexico - <state>"); every other country is',
    'listed as a whole (not by state/province).',
    'Given the city and/or state of birth below (may be in Spanish, misspelled, or',
    'informal), return the CODE of the single best matching option.',
    'If you are not reasonably confident of a match, return null.',
    'Respond ONLY with a valid JSON object: {"code": "<CODE or null>"}.',
    'Do not include any explanation, markdown, or extra text.',
    '',
    'Valid options:',
    validOptions,
    '',
    `Birth city: ${birthCity || '(sin dato)'}`,
    `Birth state/province: ${birthState || '(sin dato)'}`,
  ].join('\n');

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(`API error ${response.status}: ${err?.error?.message || 'desconocido'}`);
    }
    const data = await response.json();
    const raw = data.content?.[0]?.text || '{}';
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    const code = (parsed.code && parsed.code !== 'null') ? parsed.code : null;
    console.log('[VisasPro] Lugar de nacimiento identificado con IA:', code);
    return { code, ok: true };
  } catch (err) {
    console.error('[VisasPro] Error en identificación de lugar de nacimiento:', err);
    return { code: null, ok: false, reason: err.message };
  }
}


// ── buildClientData ──────────────────────────────────────

function buildClientData(f) {
  const p = k => processField(k, (f[k] || '').trim());
  const r = k => (f[k] || '').trim();

  return {
    // ── Información Personal 1 ──
    firstName:              p('PI1_NOMBRE_SOLICITANTE'),
    lastName:               p('PI1_APELLIDOS_SOLICITANTE'),
    gender:                 p('PI1_GENERO'),
    maritalStatus:          p('PI1_ESTADO_CIVIL'),
    dob_day:                r('PI1_DIA_NACIMIENTO_SOLICITANTE'),
    dob_month:              p('PI1_MES_NACIMIENTO_SOLICITANTE'),
    dob_year:               r('PI1_ANO_NACIMIENTO_SOLICITANTE'),
    birthCity:              p('PI1_CIUDAD_NACIMIENTO_SOLICITANTE'),
    birthState:             p('PI1_ESTADO_NACIMIENTO_SOLICITANTE'),
    birthCountryRegion:     p('PI1_PAIS_REGION_SOLICITANTE'),

    // ── Información Personal 2 ──
    curp:                   p('PI2_CURP'),

    // ── Dirección ──
    street:                 p('DIR_CALLE'),
    city:                   p('DIR_CIUDAD'),
    state:                  p('DIR_ESTADO'),
    zip:                    p('DIR_ZIP'),
    phone:                  p('DIR_CELULAR'),
    email:                  p('DIR_CORREO'),
    socialNetwork:          p('DIR_RRSS'),
    socialHandle:           r('DIR_RRSS_USER'),

    // ── Información de Viaje ──
    travelDate_day:         r('TRA_DIA_VIAJE'),
    travelDate_month:       p('TRA_MES_VIAJE'),
    travelDate_year:        r('TRA_ANO_VIAJE'),
    travelDurationNum:      r('TRA_DURACION_NUMERO'),
    travelDurationUnit:     p('TRA_DURACION_UNIDAD'),
    travelStreet:           p('TRA_HOSPEDAJE_CALLE'),
    travelCity:             p('TRA_HOSPEDAJE_CIUDAD'),
    travelState:            p('TRA_HOSPEDAJE_ESTADO'),
    travelZip:              p('TRA_HOSPEDAJE_ZIP'),
    travelPayer:            p('TRA_QUIEN_PAGA_VIAJE'),
    payerFirstName:         p('TRA_PAGA_VIAJE_NOMBRE'),
    payerLastName:          p('TRA_PAGA_VIAJE_APELLIDO'),
    payerPhone:             p('TRA_PAGA_VIAJE_TELEFONO'),
    payerRelationship:      p('TRA_PAGA_VIAJE_PARENTESCO'),
    payerStreet:            p('TRA_DIRECCION_PAGA_VIAJE_CALLE'),
    payerCity:              p('TRA_DIRECCION_PAGA_VIAJE_CIUDAD'),
    payerState:             p('TRA_DIRECCION_PAGA_VIAJE_ESTADO'),
    payerZip:               p('TRA_DIRECCION_PAGA_VIAJE_ZIP'),

    // ── Acompañantes ──
    companionFirstName:     p('TRA_COM_NOMBRE'),
    companionLastName:      p('TRA_COM_APELLIDO'),
    companionRelationship:  p('TRA_COM_PARENTESCO'),

    // ── Viajes Previos a USA ──
    prevTravel_day:         r('PUST_DIA'),
    prevTravel_month:       p('PUST_MES'),
    prevTravel_year:        r('PUST_ANO'),
    prevTravelDurationNum:  r('PUST_DURACION_NUMERO'),
    prevTravelDurationUnit: p('PUST_DURACION_UNIDAD'),
    visaIssue_day:          r('PUST_VISA_PREVIA_E_DIA'),
    visaIssue_month:        p('PUST_VISA_PREVIA_E_MES'),
    visaIssue_year:         r('PUST_VISA_PREVIA_E_ANO'),
    visaNumber:             p('PUST_VISA_PREVIA_NUMERO'),
    visaLostYear:           r('PUST_ANO_EXTRAVIO'),
    visaLostExplanation:    p('PUST_EXP_EXTRAVIO'),    // TRANSLATE
    visaRefusedExplanation: p('PUST_EXP_RECHAZO'),     // TRANSLATE

    // ── Pasaporte ──
    passportNumber:         p('PAS_NUMBER'),
    passportCity:           p('PAS_EMISION_CIUDAD'),
    passportState:          p('PAS_EMISION_ESTADO'),
    passportIssue_day:      r('PAS_EXP_DIA'),
    passportIssue_month:    p('PAS_EXP_MES'),
    passportIssue_year:     r('PAS_EXP_ANO'),
    passportExpiry_day:     r('PAS_VEN_DIA'),
    passportExpiry_month:   p('PAS_VEN_MES'),
    passportExpiry_year:    r('PAS_VEN_ANO'),
    passportLostNumber:     p('PAS_EXTRAVIO_NUM'),
    passportLostExplanation:p('PAS_EXTRAVIO_EXP'),     // TRANSLATE

    // ── Dirección de Contacto en los EUA ──
    usContactFirstName:     p('CONTUSA_NOMBRE'),
    usContactLastName:      p('CONTUSA_APELLIDO'),
    usContactHotel:         p('CONTUSA_HOTEL'),
    usContactRelationship:  p('CONTAUSA_PARENTESCO'),
    usContactStreet:        p('CONTAUSA_CALLE'),
    usContactCity:          p('CONTAUSA_CIUDAD'),
    usContactState:         p('CONTAUSA_ESTADO'),
    usContactZip:           p('CONTAUSA_ZIP'),
    usContactPhone:         p('CONTAUSA_TEL'),

    // ── Familia ──
    fatherFirstName:        p('FAM_NOMBRE_PADRE'),
    fatherLastName:         p('FAM_APELLIDO_PADRE'),
    fatherDob_day:          r('FAM_DIA_PADRE'),
    fatherDob_month:        p('FAM_MES_PADRE'),
    fatherDob_year:         r('FAM_ANO_PADRE'),
    motherFirstName:        p('FAM_NOMBRE_MADRE'),
    motherLastName:         p('FAM_APELLIDO_MADRE'),
    motherDob_day:          r('FAM_DIA_MADRE'),
    motherDob_month:        p('FAM_MES_MADRE'),
    motherDob_year:         r('FAM_ANO_MADRE'),
    usRelativeFirstName:    p('FAM_DIRECTA_NOMBRE'),
    usRelativeLastName:     p('FAM_DIRECTA_APELLIDO'),
    usRelativeRelationship: p('FAM_DIRECTA_PARENTESCO'),
    usRelativeStatus:       p('FAM_DIRECTA_ESTATUS'),
    hasOtherUSRelative:     r('FAM_OTRO_FAMILIAR'),

    // ── Pareja ──
    spouseFirstName:        p('PAREJA_NOMBRE'),
    spouseLastName:         p('PAREJA_APELLIDO'),
    spouseNationality:      p('PAREJA_NACIONALIDAD'),
    spouseDob_day:          r('PAREJA_DIA'),
    spouseDob_month:        p('PAREJA_MES'),
    spouseDob_year:         r('PAREJA_ANO'),
    spouseBirthCity:        p('PAREJA_CIUDAD'),
    spouseBirthCountry:     p('PAREJA_PAIS'),

    // ── Trabajo actual ──
    occupation:             p('WET_PRESENT_OCUPACION'),
    occupationText:         processField('WET_PRESENT_OCUPACION_TEXT', (f['WET_PRESENT_OCUPACION'] || '').trim()),
    employer:               p('WET_PRESENT_NOBRE_LUGAR'),
    workStreet:             p('WET_PRESENT_CALLE'),
    workCity:               p('WET_PRESENT_CIUDAD'),
    workState:              p('WET_PRESENT_ESTADO'),
    workZip:                p('WET_PRESENT_ZIP'),
    workPhone:              p('WET_PRESENT_TEL'),
    workStart_day:          r('WET_PRESENT_INGRESO_DIA'),
    workStart_month:        p('WET_PRESENT_INGRESO_MES'),
    workStart_year:         r('WET_PRESENT_INGRESO_ANO'),
    workSalary:             p('WET_PRESENT_INGRESO_MXN'),
    workDuties:             p('WET_PRESENT_ACTIVIDADES'), // TRANSLATE

    // ── Trabajo anterior / Estudios ──
    prevEmployer:           p('WET_PREV_NOMBRE'),
    prevWorkStreet:         p('WET_PREV_CALLE'),
    prevWorkCity:           p('WET_PREV_CIUDAD'),
    prevWorkState:          p('WET_PREV_ESTADO'),
    prevWorkZip:            p('WET_PREV_ZIP'),
    prevWorkCountry:        p('WET_PREV_PAIS'),
    prevWorkPhone:          p('WET_PREV_TEL'),
    prevJobTitle:           p('WET_PREV_PUESTO'),         // TRANSLATE
    prevSupervisorFirst:    p('WET_PREV_JEFE_NOMBRE'),
    prevSupervisorLast:     p('WET_PREV_JEFE_APELLIDO'),
    prevWorkStart_day:      r('WET_PREV_ING_DIA'),
    prevWorkStart_month:    p('WET_PREV_ING_MES'),
    prevWorkStart_year:     r('WET_PREV_ING_ANO'),
    prevWorkEnd_day:        r('WET_PREV_SALIDA_DIA'),
    prevWorkEnd_month:      p('WET_PREV_SALIDA_MES'),
    prevWorkEnd_year:       r('WET_PREV_SALIDA_ANO'),
    prevWorkDuties:         p('WET_PREV_ACTIVIDADES'),    // TRANSLATE
    schoolName:             p('EST_NOMBRE_ESCUELA'),
    schoolStreet:           p('EST_CALLE'),
    schoolCity:             p('EST_CIUDAD'),
    schoolState:            p('EST_ESTADO'),
    schoolZip:              p('EST_ZIP'),
    schoolCountry:          p('EST_PAIS'),
    schoolCourse:           p('EST_CURSO'),               // TRANSLATE
    schoolStart_day:        r('EST_ING_DIA'),
    schoolStart_month:      p('EST_ING_MES'),
    schoolStart_year:       r('EST_ING_ANO'),
    schoolEnd_day:          r('EST_SALIDA_DIA'),
    schoolEnd_month:        p('EST_SALIDA_MES'),
    schoolEnd_year:         r('EST_SALIDA_ANO'),

    // ── Adicional / Seguridad ──
    language1:              p('ADD_IDIOMA_1'),
    language2:              p('ADD_IDIOMA_2'),
    language3:              p('ADD_IDIOMA_3'),
    country1:               p('ADD_PAIS_1'),
    country2:               p('ADD_PAIS_2'),
    country3:               p('ADD_PAIS_3'),
  };
}


// ── Mapeo pdfKey → dataKey para campos TRANSLATE ─────────

const TRANSLATE_KEY_MAP = {
  'PUST_EXP_EXTRAVIO':       'visaLostExplanation',
  'PUST_EXP_RECHAZO':        'visaRefusedExplanation',
  'PAS_EXTRAVIO_EXP':        'passportLostExplanation',
  'WET_PRESENT_ACTIVIDADES': 'workDuties',
  'WET_PREV_PUESTO':         'prevJobTitle',
  'WET_PREV_ACTIVIDADES':    'prevWorkDuties',
  'EST_CURSO':               'schoolCourse',
  'ADD_IDIOMA_1':            'language1',
  'ADD_IDIOMA_2':            'language2',
  'ADD_IDIOMA_3':            'language3',
};


// ── Flujo principal ──────────────────────────────────────

document.getElementById('pdf-input').addEventListener('change', function(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.type !== 'application/pdf') { showAlert('Solo se aceptan archivos PDF.', 'error'); return; }
  processPDF(file);
});

document.getElementById('btn-clear').addEventListener('click', clearData);

document.getElementById('btn-reprocess').addEventListener('click', async () => {
  if (!window._vpLastBuffer) {
    showAlert('No hay PDF en memoria. Vuelve a cargar el archivo.', 'error');
    return;
  }
  try {
    showProgress(true);
    setProgress(55, 'Enviando a Claude Vision...');
    const rawFields = await extractWithClaudeVision(window._vpLastBuffer);
    const fieldCount = Object.keys(rawFields).length;
    if (fieldCount < 5) throw new Error(`Claude solo extrajo ${fieldCount} campos.`);

    setProgress(80, 'Aplicando reglas...');
    const data = buildClientData(rawFields);
    await chrome.storage.local.set({ visasproClientData: data });
    renderClientCard(data);
    setProgress(100, 'Listo');
    showAlert(`Re-procesado con Claude Vision: ${fieldCount} campos.`, 'success');
    setTimeout(() => showProgress(false), 800);
  } catch (err) {
    console.error('[VisasPro] Error en re-procesamiento:', err);
    showProgress(false);
    showAlert(err.message, 'error');
  }
});

const SECTION_BTNS = [
  ['btn-pi1',       'pi1'],
  ['btn-pi2',       'pi2'],
  ['btn-travel',    'travel'],
  ['btn-companions','companions'],
  ['btn-prevtravel','prevTravel'],
  ['btn-address',   'address'],
  ['btn-passport',  'passport'],
  ['btn-contact',   'contact'],
  ['btn-family',    'family'],
  ['btn-spouse',    'spouse'],
  ['btn-work',      'work'],
  ['btn-workprev',  'workPrev'],
  ['btn-additional','additional'],
  ['btn-security',  'security'],
  ['btn-review',    'review'],
];

for (const [btnId, section] of SECTION_BTNS) {
  document.getElementById(btnId).addEventListener('click', () => fillSection(section));
}


async function fillSection(section) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, { action: 'fill', section }, (response) => {
    if (chrome.runtime.lastError) {
      showAlert('Recarga la página del DS-160 y vuelve a intentar.', 'error'); return;
    }
    if (response && response.ok) {
      let msg = `${section.toUpperCase()} — ${response.filled} campos llenados.`;
      const hasNotices = response.notices && response.notices.length;
      if (hasNotices) msg += ' ⚠️ ' + response.notices.join(' ');
      showAlert(msg, hasNotices ? 'warning' : 'success');
    } else {
      showAlert(`Error: ${response?.error || 'desconocido'}`, 'error');
    }
  });
}

async function processPDF(file) {
  showProgress(true);
  setProgress(10, 'Leyendo archivo...');
  hideAlert();

  try {
    const buffer = await file.arrayBuffer();
    setProgress(30, 'Extrayendo campos...');
    let rawFields = parsePDFFields(buffer);
    let fieldCount = Object.keys(rawFields).length;

    // Guardar buffer para posible re-procesamiento manual con Claude Vision
    window._vpLastBuffer = buffer;

    // Si el parser AcroForm encuentra pocos campos, ofrecer Claude Vision
    if (fieldCount < 30) {
      console.log(`[VisasPro] Solo ${fieldCount} campos detectados, ofreciendo Claude Vision...`);
      const useVision = await askClaudeVision();
      if (!useVision) {
        throw new Error('Procesamiento cancelado. Pide al cliente que guarde el PDF con Adobe Acrobat Reader → Archivo → Guardar.');
      }
      setProgress(55, 'Enviando a Claude Vision...');
      rawFields = await extractWithClaudeVision(buffer);
      fieldCount = Object.keys(rawFields).length;
    }

    if (fieldCount < 5)
      throw new Error(`No se pudieron extraer datos del PDF (${fieldCount} campos). Verifica que sea el formulario VisasPro correcto.`);

    setProgress(55, 'Aplicando reglas...');
    const data = buildClientData(rawFields);

    const toTranslate = getTranslatableFields(rawFields);
    let translationOk = true, translationReason = null;
    if (Object.keys(toTranslate).length > 0) {
      setProgress(75, 'Traduciendo campos...');
      const result = await translateFields(toTranslate);
      translationOk = result.ok;
      translationReason = result.reason;
      for (const [pdfKey, translated] of Object.entries(result.translated)) {
        const dataKey = TRANSLATE_KEY_MAP[pdfKey];
        if (dataKey && translated) data[dataKey] = translated;
      }
    }

    // Países visitados: matching contra la lista cerrada de opciones válidas vía IA
    // (data.country1/2/3 ya tienen el valor de la tabla fija EQUIV.countries como
    // respaldo, calculado en buildClientData — la IA solo lo sobrescribe si está
    // segura de un mejor match).
    const rawCountries = {
      country1: rawFields['ADD_PAIS_1'],
      country2: rawFields['ADD_PAIS_2'],
      country3: rawFields['ADD_PAIS_3'],
    };
    const hasCountries = Object.values(rawCountries).some(v => v && v.trim());
    let countryMatchOk = true, countryMatchReason = null;
    if (hasCountries) {
      setProgress(85, 'Identificando países visitados...');
      const countryResult = await matchCountriesWithAI(rawCountries);
      countryMatchOk = countryResult.ok;
      countryMatchReason = countryResult.reason;
      for (const [dataKey, code] of Object.entries(countryResult.matched)) {
        if (code && code !== 'null') data[dataKey] = code;
      }
    }

    // Lugar de nacimiento (país o estado de México): PI1_PAIS_REGION_SOLICITANTE no
    // siempre trae un código utilizable — puede faltar, o venir con un valor genérico
    // como "Mexico" que no tiene equivalencia directa en EQUIV.paisRegion (ese select
    // no tiene una opción plana "MEXICO", solo "MEXICO - <ESTADO>"). En ese caso
    // processField devuelve el texto crudo sin resolver, que NO es un código válido
    // del select real — hay que detectarlo así en vez de solo revisar si está vacío,
    // o el fillSelect del content script falla en silencio. Se usa birthCity +
    // birthState (que el PDF sí trae) para que la IA determine la opción correcta.
    const validBirthPlaceCodes = new Set(Object.values(EQUIV.paisRegion));
    let birthPlaceOk = true, birthPlaceReason = null;
    const needsBirthPlace = !validBirthPlaceCodes.has(data.birthCountryRegion)
      && (data.birthCity || data.birthState);
    if (needsBirthPlace) {
      setProgress(90, 'Identificando lugar de nacimiento...');
      const birthResult = await matchBirthPlaceWithAI(data.birthCity, data.birthState);
      birthPlaceOk = birthResult.ok;
      birthPlaceReason = birthResult.reason;
      if (birthResult.code) data.birthCountryRegion = birthResult.code;
    }

    // Lugar de nacimiento de la pareja (ddlSpousePOBCountry) — mismo select real
    // (mismas ~280 opciones, incluye estados de México) que ddlAPP_POB_CNTRY, y
    // mismo problema: PAREJA_PAIS puede venir con un valor genérico como "Mexico"
    // sin resolver. Se reutiliza matchBirthPlaceWithAI, pero aquí solo hay ciudad
    // (el PDF de VisasPro no trae un estado de nacimiento separado para la pareja).
    let spouseBirthPlaceOk = true, spouseBirthPlaceReason = null;
    const needsSpouseBirthPlace = !validBirthPlaceCodes.has(data.spouseBirthCountry)
      && data.spouseBirthCity;
    if (needsSpouseBirthPlace) {
      setProgress(92, 'Identificando lugar de nacimiento de la pareja...');
      const spouseBirthResult = await matchBirthPlaceWithAI(data.spouseBirthCity, null);
      spouseBirthPlaceOk = spouseBirthResult.ok;
      spouseBirthPlaceReason = spouseBirthResult.reason;
      if (spouseBirthResult.code) data.spouseBirthCountry = spouseBirthResult.code;
    }

    setProgress(100, '¡Listo!');
    chrome.storage.local.set({ visasproClientData: data });
    showProgress(false);
    renderClientCard(data);

    const tCount = Object.keys(toTranslate).length;
    const notices = [];
    if (tCount > 0 && !translationOk) {
      notices.push(translationReason === 'no-api-key'
        ? `no se tradujeron ${tCount} campos (configura tu API key en ⚙️), quedaron en español`
        : `falló la traducción de ${tCount} campos, quedaron en español`);
    }
    if (hasCountries && !countryMatchOk) {
      notices.push(countryMatchReason === 'no-api-key'
        ? 'no se identificaron los países visitados con IA (configura tu API key en ⚙️), se usó la tabla básica'
        : 'falló la identificación de países visitados con IA, se usó la tabla básica');
    }
    if (needsBirthPlace && (!birthPlaceOk || !data.birthCountryRegion)) {
      notices.push(birthPlaceReason === 'no-api-key'
        ? 'no se identificó el país/estado de nacimiento con IA (configura tu API key en ⚙️), llénalo manualmente'
        : !birthPlaceOk
          ? 'falló la identificación del país/estado de nacimiento con IA, llénalo manualmente'
          : 'la IA no tuvo certeza del país/estado de nacimiento, llénalo manualmente');
    }
    if (needsSpouseBirthPlace && (!spouseBirthPlaceOk || !data.spouseBirthCountry)) {
      notices.push(spouseBirthPlaceReason === 'no-api-key'
        ? 'no se identificó el país/estado de nacimiento de la pareja con IA (configura tu API key en ⚙️), llénalo manualmente'
        : !spouseBirthPlaceOk
          ? 'falló la identificación del país/estado de nacimiento de la pareja con IA, llénalo manualmente'
          : 'la IA no tuvo certeza del país/estado de nacimiento de la pareja, llénalo manualmente');
    }

    let msg = `PDF cargado. ${fieldCount} campos`;
    if (tCount > 0 && translationOk) msg += `, ${tCount} traducidos`;
    msg += '.';
    if (notices.length) msg += ' ⚠️ ' + notices.join('; ') + '.';
    showAlert(msg, notices.length ? 'warning' : 'success');
  } catch (err) {
    console.error('[VisasPro] Error:', err);
    showProgress(false);
    showAlert(err.message, 'error');
  }
}


// ── Renderizar tarjeta ───────────────────────────────────

function renderClientCard(data) {
  const fullName = `${data.firstName} ${data.lastName}`.trim();
  const initials = ((data.firstName||'')[0]||'') + ((data.lastName||'')[0]||'');
  document.getElementById('avatar').textContent      = initials.toUpperCase() || '?';
  document.getElementById('client-name').textContent = fullName || '—';
  document.getElementById('client-sub').textContent  = data.curp || '—';

  document.getElementById('data-grid').innerHTML = `
    <div class="data-item"><div class="lbl">Nacimiento</div>
      <div class="val">${data.dob_day}/${data.dob_month}/${data.dob_year}</div></div>
    <div class="data-item"><div class="lbl">Género</div>
      <div class="val">${data.gender || '—'}</div></div>
    <div class="data-item"><div class="lbl">Estado Civil</div>
      <div class="val">${data.maritalStatus || '—'}</div></div>
    <div class="data-item"><div class="lbl">Pasaporte</div>
      <div class="val">${data.passportNumber || '—'}</div></div>
  `;

  document.getElementById('step1').style.display       = 'none';
  document.getElementById('client-card').style.display = 'block';
}


// ── Limpiar ──────────────────────────────────────────────

function clearData() {
  chrome.storage.local.remove('visasproClientData');
  document.getElementById('client-card').style.display = 'none';
  document.getElementById('step1').style.display       = 'block';
  document.getElementById('pdf-input').value           = '';
  hideAlert();
}


// ── UI helpers ───────────────────────────────────────────

function showProgress(show) { document.getElementById('progress-wrap').style.display = show ? 'block' : 'none'; }
function setProgress(pct, msg) {
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('progress-pct').textContent  = pct + '%';
  if (msg) document.getElementById('progress-msg').textContent = msg;
}
function showAlert(msg, type) {
  const el = document.getElementById('alert');
  el.textContent = msg; el.className = `alert ${type}`; el.style.display = 'block';
}
function hideAlert() { document.getElementById('alert').style.display = 'none'; }


// ── Restaurar al abrir popup ─────────────────────────────



// ── Configuración API Key ────────────────────────────────

document.getElementById('btn-settings').addEventListener('click', () => {
  const panel = document.getElementById('settings-panel');
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  if (panel.style.display === 'block') loadKeyStatus();
});

function loadKeyStatus() {
  chrome.storage.local.get('vp_api_key', result => {
    const status = document.getElementById('key-status');
    if (result.vp_api_key) {
      const masked = result.vp_api_key.slice(0, 12) + '...' + result.vp_api_key.slice(-4);
      status.textContent = '✅ Key configurada: ' + masked;
      status.style.color = '#276749';
    } else {
      status.textContent = '⚠️ Sin API key — Claude Vision no disponible';
      status.style.color = '#9b1c1c';
    }
  });
}

document.getElementById('btn-save-key').addEventListener('click', () => {
  const key = document.getElementById('api-key-input').value.trim();
  if (!key.startsWith('sk-ant-')) {
    document.getElementById('key-status').textContent = '❌ Formato inválido. Debe empezar con sk-ant-';
    document.getElementById('key-status').style.color = '#9b1c1c';
    return;
  }
  chrome.storage.local.set({ vp_api_key: key }, () => {
    document.getElementById('api-key-input').value = '';
    loadKeyStatus();
  });
});

document.getElementById('btn-clear-key').addEventListener('click', () => {
  chrome.storage.local.remove('vp_api_key', () => {
    document.getElementById('api-key-input').value = '';
    loadKeyStatus();
  });
});

// ── Claude Vision — extraer campos de PDF flatten ────────

async function extractWithClaudeVision(buffer) {
  const result = await chrome.storage.local.get('vp_api_key');
  const apiKey = result.vp_api_key;

  if (!apiKey) {
    throw new Error('No hay API key configurada. Configúrala en ⚙️');
  }

  setProgress(60, 'Convirtiendo PDF a imágenes...');
  const images = await pdfToImages(buffer, 150, 0.85);
  console.log(`[VP] ${images.length} imágenes generadas`);

  setProgress(70, 'Claude analizando las páginas...');

  const messageContent = images.map(b64 => ({
    type: 'image',
    source: {
      type: 'base64',
      media_type: 'image/jpeg',
      data: b64,
    }
  }));

  messageContent.push({
    type: 'text',
    text: `Estas son las páginas de un formulario PDF de VisasPro para trámite de visa americana DS-160.
Extrae TODOS los campos llenados y devuelve ÚNICAMENTE un JSON válido.
Si un campo está vacío o dice "no aplica" / "n/a", omítelo del JSON.
Devuelve SOLO el JSON sin texto adicional ni bloques de código markdown.

Usa exactamente estos nombres de campo (incluye solo los que tengan valor):
PI1_NOMBRE_SOLICITANTE, PI1_APELLIDOS_SOLICITANTE, PI1_GENERO, PI1_ESTADO_CIVIL,
PI1_DIA_NACIMIENTO_SOLICITANTE, PI1_MES_NACIMIENTO_SOLICITANTE, PI1_ANO_NACIMIENTO_SOLICITANTE,
PI1_CIUDAD_NACIMIENTO_SOLICITANTE, PI1_ESTADO_NACIMIENTO_SOLICITANTE, PI1_PAIS_REGION_SOLICITANTE,
PI2_CURP, TRA_DIA_VIAJE, TRA_MES_VIAJE, TRA_ANO_VIAJE, TRA_DURACION_NUMERO, TRA_DURACION_UNIDAD,
TRA_HOSPEDAJE_CALLE, TRA_HOSPEDAJE_CIUDAD, TRA_HOSPEDAJE_ESTADO, TRA_HOSPEDAJE_ZIP,
TRA_QUIEN_PAGA_VIAJE, TRA_PAGA_VIAJE_NOMBRE, TRA_PAGA_VIAJE_APELLIDO, TRA_PAGA_VIAJE_TELEFONO,
TRA_PAGA_VIAJE_PARENTESCO, TRA_COM_NOMBRE, TRA_COM_APELLIDO, TRA_COM_PARENTESCO,
DIR_CALLE, DIR_CIUDAD, DIR_ESTADO, DIR_PAIS, DIR_ZIP, DIR_CELULAR, DIR_CORREO, DIR_RRSS, DIR_RRSS_USER,
PAS_NUMBER, PAS_EMISION_CIUDAD, PAS_EMISION_ESTADO, PAS_EMISION_PAIS,
PAS_EXP_DIA, PAS_EXP_MES, PAS_EXP_ANO, PAS_VEN_DIA, PAS_VEN_MES, PAS_VEN_ANO,
CONTUSA_NOMBRE, CONTUSA_APELLIDO, CONTAUSA_PARENTESCO, CONTAUSA_CALLE, CONTAUSA_CIUDAD,
CONTAUSA_ESTADO, CONTAUSA_ZIP, CONTAUSA_TEL,
FAM_NOMBRE_PADRE, FAM_APELLIDO_PADRE, FAM_DIA_PADRE, FAM_MES_PADRE, FAM_ANO_PADRE,
FAM_NOMBRE_MADRE, FAM_APELLIDO_MADRE, FAM_DIA_MADRE, FAM_MES_MADRE, FAM_ANO_MADRE,
FAM_OTRO_FAMILIAR, WET_PRESENT_OCUPACION, WET_PRESENT_NOBRE_LUGAR,
WET_PRESENT_CALLE, WET_PRESENT_CIUDAD, WET_PRESENT_ESTADO, WET_PRESENT_ZIP,
WET_PRESENT_TEL, WET_PRESENT_INGRESO_DIA, WET_PRESENT_INGRESO_MES, WET_PRESENT_INGRESO_ANO,
WET_PRESENT_INGRESO_MXN, WET_PRESENT_ACTIVIDADES`
  });

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-5',
      max_tokens: 4096,
      messages: [{ role: 'user', content: messageContent }]
    })
  });

  console.log('[VP] Claude Vision response status:', response.status);

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`API error ${response.status}: ${err.error?.message || 'desconocido'}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || '';
  console.log('[VP] Claude text response:', text.slice(0, 300));

  const clean = text.replace(/```json|```/g, '').trim();
  const fields = JSON.parse(clean);
  console.log('[VP] Campos extraídos por Claude:', Object.keys(fields).length);

  return fields;
}

// ── Confirmación antes de usar Claude Vision ─────────────

function askClaudeVision() {
  return new Promise(resolve => {
    const dialog = document.getElementById('vision-dialog');
    dialog.style.display = 'flex';

    document.getElementById('vision-confirm').onclick = () => {
      dialog.style.display = 'none';
      resolve(true);
    };
    document.getElementById('vision-cancel').onclick = () => {
      dialog.style.display = 'none';
      resolve(false);
    };
  });
}

chrome.storage.local.get('visasproClientData', result => {
  if (result.visasproClientData) renderClientCard(result.visasproClientData);
});
