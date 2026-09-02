// ════════════════════════════════════════════════════════
//  VISASPRO — CONTENT-CITAS.JS  v1.23.0
//  Corre en ais.usvisa-info.com (Sistema de Citas / AIS de GDIT).
//  Llena el formulario "Crear solicitante" (applicants/new) con los datos
//  ya guardados en ClickUp para el trámite elegido en el popup. Mapeo de
//  campos armado a partir de un dump real del formulario (ver
//  CONTEXTO_PROYECTO.md, v1.21.0).
//
//  v1.21.1: el sitio tiene al menos un <select> "disfrazado" con un widget
//  JS propio (dropdown dibujado con <li>) que truena internamente al
//  cambiarle el valor por código (visto en consola:
//  "Cannot read properties of null (reading 'autoclose')" en el JS del
//  sitio). Cada campo ahora corre aislado en su propio try/catch para que
//  un campo que truene no le impida al resto llenarse — antes todo el
//  llenado dependía de una sola función sin aislar errores por campo.
// ════════════════════════════════════════════════════════

// En un <select>, asignar un value que no calza con ninguna <option> no
// truena — el navegador simplemente deja el select sin selección (value
// vuelve a ''). Sin verificar esto reportábamos "éxito" aunque en realidad
// no se hubiera seleccionado nada (así se detectó el bug de v1.21.4: un
// campo de texto libre le pisaba el valor a un <select> ya bien llenado).
function setValue(id, value) {
  const el = document.getElementById(id);
  if (!el || value === null || value === undefined || value === '') return false;
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return String(el.value) === String(value);
}

function setRadio(name, value) {
  const el = document.querySelector(`input[type="radio"][name="${CSS.escape(name)}"][value="${CSS.escape(value)}"]`);
  if (!el) return false;
  el.checked = true;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return el.checked;
}

// Para campos sin id fijo (los "mission_specific_values" cambian de índice
// según la misión/consulado) — ubica el <label> por su texto EXACTO (sin el
// asterisco de obligatorio) y llena el input/select asociado. Tiene que ser
// exacto y no "empieza con": "País de Residencia" y "País de Residencia
// Permanente" son 2 campos distintos, y "empieza con" hacía que este
// buscara siempre el de Permanente (aparece antes en el formulario).
function setByLabel(labelExact, value) {
  if (value === null || value === undefined || value === '') return false;
  const target = labelExact.trim().toLowerCase();
  const label = Array.from(document.querySelectorAll('label'))
    .find(l => l.innerText.trim().toLowerCase().replace(/\*+$/, '').trim() === target);
  if (!label) return false;
  const forId = label.getAttribute('for');
  const el = forId ? document.getElementById(forId) : label.querySelector('input, select, textarea');
  if (!el) return false;
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return String(el.value) === String(value);
}

const MONTH_CODE_TO_NUM = { JAN:1, FEB:2, MAR:3, APR:4, MAY:5, JUN:6, JUL:7, AUG:8, SEP:9, OCT:10, NOV:11, DEC:12 };

// Código B1/B2 en los <select> de "Tipo de Visa" y "Clase de visa anterior"
// del Sistema de Citas — confirmado con el usuario, siempre es este valor.
const VISA_CLASS_B1B2 = '2';

// Consulado ("Nombre del Consulado que emite la visa") — el usuario pidió
// que siempre sea Monterrey (value "71" en el <select>), sin depender de
// "Ubicación del CAS" de ClickUp.
const CONSULADO_MONTERREY = '71';

function fillCitas(data) {
  const filled = [];
  const skipped = [];
  const errors = [];

  // Aísla cada campo: si fn() truena, se registra el error con su label y
  // se sigue con el siguiente campo — un campo roto ya no bloquea a los demás.
  function track(label, fn) {
    console.log(`[VP-Citas] Intentando: ${label}`);
    try {
      const ok = fn();
      (ok ? filled : skipped).push(label);
      console.log(`[VP-Citas]   ${ok ? '✅ OK' : '— sin dato, se saltó'}: ${label}`);
    } catch (err) {
      console.error(`[VP-Citas]   ❌ Error en "${label}":`, err);
      errors.push(`${label} (${err.message})`);
    }
  }

  track('Nombre',                         () => setValue('applicant_first_name', data.nombre));
  track('Apellido',                       () => setValue('applicant_last_name', data.apellido));
  track('País de nacionalidad',           () => setValue('applicant_passport_country_code', 'MX'));
  track('País de Nacimiento',             () => setValue('applicant_birth_country_code', 'MX'));
  track('País de Residencia Permanente',  () => setValue('applicant_permanent_residency_country_code', 'mx'));
  track('Número de pasaporte',            () => setValue('applicant_passport_number', data.pasaporte));
  track('Número DS-160',                  () => setValue('applicant_ds160_number', data.ds160Id));
  track('Tipo de Visa',                   () => setValue('applicant_visa_class_id', VISA_CLASS_B1B2));

  if (data.dobDay && data.dobMonthCode && data.dobYear) {
    track('Fecha de Nacimiento (día)',  () => setValue('applicant_date_of_birth_3i', String(Number(data.dobDay))));
    track('Fecha de Nacimiento (mes)',  () => setValue('applicant_date_of_birth_2i', String(MONTH_CODE_TO_NUM[data.dobMonthCode] || '')));
    track('Fecha de Nacimiento (año)',  () => setValue('applicant_date_of_birth_1i', data.dobYear));
  } else {
    skipped.push('Fecha de Nacimiento (sin dato completo)');
  }

  track('Teléfono principal',   () => setValue('applicant_phone1', data.telefono));
  track('Código de país móvil', () => setValue('applicant_mobile_country_code', 'MX'));
  track('Teléfono Móvil',       () => setValue('applicant_mobile_phone', data.telefono));
  track('Correo electrónico',   () => setValue('applicant_email_address', data.correo));

  track('Estado de Residencia', () => setByLabel('Estado de Residencia', data.estado));
  track('País de Residencia',   () => setByLabel('País de Residencia', 'MEXICO'));

  track('Visa Previa (¿es renovación?)', () => setRadio('applicant[is_a_renewal]', data.visaPrevia ? 'true' : 'false'));
  // Regla confirmada con el usuario: siempre "No".
  track('¿Viajará para aplicar?', () => setRadio('applicant[traveling_to_apply]', 'false'));

  track('Consulado', () => setValue('applicant_visa_issuing_facility_id', CONSULADO_MONTERREY));

  // Regla confirmada con el usuario: siempre B1/B2, independientemente de si
  // hay visa previa o no (el <select> es obligatorio de todas formas).
  track('Clase de visa anterior', () => setValue('applicant_previous_visa_class_id', VISA_CLASS_B1B2));

  if (data.visaPrevia) {
    if (data.visaEmisionDia && data.visaEmisionMesCode && data.visaEmisionAno) {
      track('Fecha Emisión Visa Anterior (día)', () => setValue('applicant_visa_issue_date_3i', String(Number(data.visaEmisionDia))));
      track('Fecha Emisión Visa Anterior (mes)', () => setValue('applicant_visa_issue_date_2i', String(MONTH_CODE_TO_NUM[data.visaEmisionMesCode] || '')));
      track('Fecha Emisión Visa Anterior (año)', () => setValue('applicant_visa_issue_date_1i', data.visaEmisionAno));
    } else {
      skipped.push('Fecha de Emisión Visa Anterior (sin dato completo)');
    }
    if (data.visaVencimientoDia && data.visaVencimientoMesCode && data.visaVencimientoAno) {
      track('Fecha Vencimiento Visa Anterior (día)', () => setValue('applicant_visa_expiration_date_3i', String(Number(data.visaVencimientoDia))));
      track('Fecha Vencimiento Visa Anterior (mes)', () => setValue('applicant_visa_expiration_date_2i', String(MONTH_CODE_TO_NUM[data.visaVencimientoMesCode] || '')));
      track('Fecha Vencimiento Visa Anterior (año)', () => setValue('applicant_visa_expiration_date_1i', data.visaVencimientoAno));
    } else {
      // Pendiente: la fecha de vencimiento de la visa previa en el PDF
      // (PUST_VISA_PREVIA_V_DIA/_V_ANO) todavía no está confirmada — ver
      // CONTEXTO_PROYECTO.md v1.19.3.
      skipped.push('Fecha de Vencimiento Visa Anterior (sin dato — ver debug pendiente del PDF)');
    }
  }

  // "Número de Petición": sin regla de negocio todavía, se deja tal cual
  // (pendiente con el usuario).
  skipped.push('Número de Petición (sin regla definida, se llena a mano)');

  console.log(`[VP-Citas] Terminado. Llenados: ${filled.length}, saltados: ${skipped.length}, errores: ${errors.length}`);
  return { filled: filled.length, skipped, errors };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action !== 'fillCitas') return;
  console.log('[VP-Citas] Mensaje "fillCitas" recibido:', message.data);
  try {
    const result = fillCitas(message.data || {});
    sendResponse({ ok: true, ...result });
  } catch (err) {
    console.error('[VP-Citas] Error general (fuera de un campo individual):', err);
    sendResponse({ ok: false, error: err.message });
  }
  return true;
});

console.log('[VisasPro] Content script de Citas activo en:', window.location.href);
