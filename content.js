// ════════════════════════════════════════════════════════
//  VISASPRO — CONTENT.JS  v2.1
// ════════════════════════════════════════════════════════

// ── Helpers ──────────────────────────────────────────────

function fillInput(id, value) {
  const el = document.getElementById(id);
  if (!el || !value || value.trim() === '') return false;
  el.focus(); el.value = value;
  el.dispatchEvent(new Event('input',  { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur',   { bubbles: true }));
  console.log(`[VP] fillInput  #${id} = "${value}"`);
  return true;
}

function fillSelect(id, value) {
  const el = document.getElementById(id);
  if (!el || !value) return false;
  const lv = value.toString().toLowerCase();
  for (const opt of el.options) {
    if (opt.value.toLowerCase() === lv || opt.text.toLowerCase() === lv) {
      el.value = opt.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      console.log(`[VP] fillSelect #${id} = "${opt.value}"`);
      return true;
    }
  }
  console.warn(`[VP] fillSelect #${id}: sin coincidencia para "${value}"`);
  return false;
}

function fillRadio(id) {
  const el = document.getElementById(id);
  if (!el) return false;
  el.click(); el.dispatchEvent(new Event('change', { bubbles: true }));
  console.log(`[VP] fillRadio  #${id}`);
  return true;
}

function fillCheckbox(id, check = true) {
  const el = document.getElementById(id);
  if (!el) return false;
  if (el.checked !== check) el.click();
  console.log(`[VP] fillCheck  #${id} = ${check}`);
  return true;
}

function waitFor(id, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const el = document.getElementById(id);
    if (el) { resolve(el); return; }
    const obs = new MutationObserver(() => {
      const found = document.getElementById(id);
      if (found) { obs.disconnect(); resolve(found); }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { obs.disconnect(); reject(new Error('Timeout: ' + id)); }, timeout);
  });
}

const PH = 'ctl00_SiteContentPlaceHolder_FormView1_';
const id  = s => `${PH}${s}`;


// ── PI1 — Información Personal 1 ────────────────────────

function fillPI1(data) {
  let ok = 0;
  if (fillInput(id('tbxAPP_SURNAME'),    data.lastName))  ok++;
  if (fillInput(id('tbxAPP_GIVEN_NAME'), data.firstName)) ok++;
  fillCheckbox(id('cbexAPP_FULL_NAME_NATIVE_NA'), true);
  fillRadio(id('rblOtherNames_1'));
  fillRadio(id('rblTelecodeQuestion_1'));
  if (fillSelect(id('ddlAPP_GENDER'),         data.gender))        ok++;
  if (fillSelect(id('ddlAPP_MARITAL_STATUS'), data.maritalStatus)) ok++;
  if (fillSelect(id('ddlDOBDay'),   data.dob_day))   ok++;
  if (fillSelect(id('ddlDOBMonth'), data.dob_month)) ok++;
  if (fillInput( id('tbxDOBYear'),  data.dob_year))  ok++;
  if (fillInput( id('tbxAPP_POB_CITY'),        data.birthCity))   ok++;
  if (fillInput( id('tbxAPP_POB_ST_PROVINCE'), data.birthState))  ok++;
  if (fillSelect(id('ddlAPP_POB_CNTRY'),       data.nationality)) ok++;
  console.log(`[VP] PI1: ${ok}`); return ok;
}


// ── PI2 — Información Personal 2 ────────────────────────

function fillPI2(data) {
  let ok = 0;
  if (fillSelect(id('ddlAPP_NATL'), 'MEX')) ok++;
  fillRadio(id('rblAPP_OTH_NATL_IND_1'));
  fillRadio(id('rblPermResOtherCntryInd_1'));
  if (data.curp) {
    fillCheckbox(id('cbexAPP_NATIONAL_ID_NA'), false);
    if (fillInput(id('tbxAPP_NATIONAL_ID'), data.curp)) ok++;
  }
  fillCheckbox(id('cbexAPP_SSN_NA'),    true);
  fillCheckbox(id('cbexAPP_TAX_ID_NA'), true);
  console.log(`[VP] PI2: ${ok}`); return ok;
}


// ── TRAVEL — Información de Viaje ───────────────────────

async function fillTravel(data) {
  let ok = 0;
  if (fillSelect(id('dlPrincipalAppTravel_ctl00_ddlPurposeOfTrip'), 'B')) ok++;
  try { await waitFor(id('dlPrincipalAppTravel_ctl00_ddlOtherPurpose')); } catch(e) {}
  if (fillSelect(id('dlPrincipalAppTravel_ctl00_ddlOtherPurpose'), 'B1-B2')) ok++;
  fillRadio(id('rblSpecificTravel_0'));
  try { await waitFor(id('ddlTRAVEL_DTEDay')); } catch(e) {}
  if (fillSelect(id('ddlTRAVEL_DTEDay'),   data.travelDate_day))   ok++;
  if (fillSelect(id('ddlTRAVEL_DTEMonth'), data.travelDate_month)) ok++;
  if (fillInput( id('tbxTRAVEL_DTEYear'),  data.travelDate_year))  ok++;
  if (fillInput( id('tbxTRAVEL_LOS'),      data.travelDurationNum))  ok++;
  if (fillSelect(id('ddlTRAVEL_LOS_CD'),   data.travelDurationUnit)) ok++;
  if (fillInput( id('tbxStreetAddress1'),  data.travelStreet)) ok++;
  if (fillInput( id('tbxCity'),            data.travelCity))   ok++;
  if (fillSelect(id('ddlTravelState'),     data.travelState))  ok++;
  if (fillInput( id('tbZIPCode'),          data.travelZip))    ok++;
  if (fillSelect(id('ddlWhoIsPaying'), data.travelPayer)) ok++;
  if (data.travelPayer !== 'S') {
    try { await waitFor(id('tbxPayerSurname')); } catch(e) {}
    if (fillInput( id('tbxPayerSurname'),   data.payerLastName))   ok++;
    if (fillInput( id('tbxPayerGivenName'), data.payerFirstName))  ok++;
    if (fillInput( id('tbxPayerPhone'),     data.payerPhone))      ok++;
    fillCheckbox(id('cbxDNAPAYER_EMAIL_ADDR_NA'), true);
    if (fillSelect(id('ddlPayerRelationship'), data.payerRelationship)) ok++;
    if (data.payerStreet) {
      fillRadio(id('rblPayerAddrSameAsInd_1'));
      try { await waitFor(id('tbxPayerStreetAddress1')); } catch(e) {}
      if (fillInput( id('tbxPayerStreetAddress1'), data.payerStreet)) ok++;
      if (fillInput( id('tbxPayerCity'),            data.payerCity))  ok++;
      if (fillInput( id('tbxPayerStateProvince'),   data.payerState)) ok++;
      if (fillInput( id('tbxPayerPostalZIPCode'),   data.payerZip))   ok++;
      if (fillSelect(id('ddlPayerCountry'), 'MEX')) ok++;
    } else {
      fillRadio(id('rblPayerAddrSameAsInd_0'));
    }
  }
  console.log(`[VP] Travel: ${ok}`); return ok;
}


// ── COMPANIONS — Acompañantes ────────────────────────────

async function fillCompanions(data) {
  let ok = 0;
  if (data.companionFirstName) {
    fillRadio(id('rblOtherPersonsTravelingWithYou_0'));
    try { await waitFor(id('dlTravelCompanions_ctl00_tbxGivenName')); } catch(e) {}
    if (fillInput( id('dlTravelCompanions_ctl00_tbxGivenName'), data.companionFirstName))    ok++;
    if (fillInput( id('dlTravelCompanions_ctl00_tbxSurname'),   data.companionLastName))     ok++;
    if (fillSelect(id('dlTravelCompanions_ctl00_ddlTCRelationship'), data.companionRelationship)) ok++;
  } else {
    fillRadio(id('rblOtherPersonsTravelingWithYou_1'));
  }
  fillRadio(id('rblGroupTravel_1'));
  console.log(`[VP] Companions: ${ok}`); return ok;
}


// ── PREV TRAVEL — Viajes Previos a USA ──────────────────

async function fillPrevTravel(data) {
  let ok = 0;
  if (data.prevTravel_day) {
    fillRadio(id('rblPREV_US_TRAVEL_IND_0'));
    try { await waitFor(id('dtlPREV_US_VISIT_ctl00_ddlPREV_US_VISIT_DTEDay')); } catch(e) {}
    if (fillSelect(id('dtlPREV_US_VISIT_ctl00_ddlPREV_US_VISIT_DTEDay'),   data.prevTravel_day))         ok++;
    if (fillSelect(id('dtlPREV_US_VISIT_ctl00_ddlPREV_US_VISIT_DTEMonth'), data.prevTravel_month))       ok++;
    if (fillInput( id('dtlPREV_US_VISIT_ctl00_tbxPREV_US_VISIT_DTEYear'),  data.prevTravel_year))        ok++;
    if (fillInput( id('dtlPREV_US_VISIT_ctl00_tbxPREV_US_VISIT_LOS'),      data.prevTravelDurationNum))  ok++;
    if (fillSelect(id('dtlPREV_US_VISIT_ctl00_ddlPREV_US_VISIT_LOS_CD'),   data.prevTravelDurationUnit)) ok++;
  } else {
    fillRadio(id('rblPREV_US_TRAVEL_IND_1'));
  }
  fillRadio(id('rblPREV_US_DRIVER_LIC_IND_1'));
  if (data.visaIssue_day) {
    fillRadio(id('rblPREV_VISA_IND_0'));
    try { await waitFor(id('ddlPREV_VISA_ISSUED_DTEDay')); } catch(e) {}
    if (fillSelect(id('ddlPREV_VISA_ISSUED_DTEDay'),   data.visaIssue_day))   ok++;
    if (fillSelect(id('ddlPREV_VISA_ISSUED_DTEMonth'), data.visaIssue_month)) ok++;
    if (fillInput( id('tbxPREV_VISA_ISSUED_DTEYear'),  data.visaIssue_year))  ok++;
    if (fillInput( id('tbxPREV_VISA_FOIL_NUMBER'),     data.visaNumber))      ok++;
    fillRadio(id('rblPREV_VISA_SAME_TYPE_IND_0'));
    fillRadio(id('rblPREV_VISA_SAME_CNTRY_IND_0'));
    fillRadio(id('rblPREV_VISA_TEN_PRINT_IND_0'));
    if (data.visaLostYear) {
      fillRadio(id('rblPREV_VISA_LOST_IND_0'));
      try { await waitFor(id('tbxPREV_VISA_LOST_YEAR')); } catch(e) {}
      if (fillInput(id('tbxPREV_VISA_LOST_YEAR'), data.visaLostYear))        ok++;
      if (fillInput(id('tbxPREV_VISA_LOST_EXPL'), data.visaLostExplanation)) ok++;
    } else {
      fillRadio(id('rblPREV_VISA_LOST_IND_1'));
    }
    if (data.visaRefusedExplanation) {
      fillRadio(id('rblPREV_VISA_REFUSED_IND_0'));
      try { await waitFor(id('tbxPREV_VISA_REFUSED_EXPL')); } catch(e) {}
      if (fillInput(id('tbxPREV_VISA_REFUSED_EXPL'), data.visaRefusedExplanation)) ok++;
    } else {
      fillRadio(id('rblPREV_VISA_REFUSED_IND_1'));
    }
  } else {
    fillRadio(id('rblPREV_VISA_IND_1'));
  }
  fillRadio(id('rblIV_PETITION_IND_1'));
  console.log(`[VP] PrevTravel: ${ok}`); return ok;
}


// ── ADDRESS — Dirección ──────────────────────────────────

function fillAddress(data) {
  let ok = 0;
  if (fillInput( id('tbxAPP_ADDR_LN1'),      data.street)) ok++;
  if (fillInput( id('tbxAPP_ADDR_CITY'),      data.city))   ok++;
  if (fillInput( id('tbxAPP_ADDR_STATE'),     data.state))  ok++;
  if (fillSelect(id('ddlCountry'), 'MEX'))                  ok++;
  if (fillInput( id('tbxAPP_ADDR_POSTAL_CD'), data.zip))    ok++;
  fillRadio(id('rblMailingAddrSame_0'));
  if (fillInput(id('tbxAPP_HOME_TEL'), data.phone)) ok++;
  fillCheckbox(id('cbexAPP_MOBILE_TEL_NA'), true);
  fillCheckbox(id('cbexAPP_BUS_TEL_NA'),    true);
  fillRadio(id('rblAddPhone_1'));
  if (fillInput(id('tbxAPP_EMAIL_ADDR'), data.email)) ok++;
  fillRadio(id('rblAddEmail_1'));
  if (data.socialNetwork && data.socialNetwork !== 'NONE') {
    if (fillSelect(id('dtlSocial_ctl00_ddlSocialMedia'),      data.socialNetwork)) ok++;
    if (fillInput( id('dtlSocial_ctl00_tbxSocialMediaIdent'), data.socialHandle))  ok++;
  }
  fillRadio(id('rblAddSocial_1'));
  console.log(`[VP] Address: ${ok}`); return ok;
}


// ── PASSPORT — Pasaporte ─────────────────────────────────

async function fillPassport(data) {
  let ok = 0;
  if (fillSelect(id('ddlPPT_TYPE'), 'R')) ok++;
  if (fillInput(id('tbxPPT_NUM'), data.passportNumber)) ok++;
  fillCheckbox(id('cbexPPT_BOOK_NUM_NA'), true);
  if (fillInput( id('tbxPPT_ISSUED_IN_CITY'),  data.passportCity))  ok++;
  if (fillInput( id('tbxPPT_ISSUED_IN_STATE'), data.passportState)) ok++;
  if (fillSelect(id('ddlPPT_ISSUED_DTEDay'),   data.passportIssue_day))   ok++;
  if (fillSelect(id('ddlPPT_ISSUED_DTEMonth'), data.passportIssue_month)) ok++;
  if (fillInput( id('tbxPPT_ISSUEDYear'),      data.passportIssue_year))  ok++;
  if (fillSelect(id('ddlPPT_EXPIRE_DTEDay'),   data.passportExpiry_day))   ok++;
  if (fillSelect(id('ddlPPT_EXPIRE_DTEMonth'), data.passportExpiry_month)) ok++;
  if (fillInput( id('tbxPPT_EXPIREYear'),      data.passportExpiry_year))  ok++;
  if (data.passportLostExplanation) {
    fillRadio(id('rblLOST_PPT_IND_0'));
    try { await waitFor(id('dtlLostPPT_ctl00_tbxLOST_PPT_NUM')); } catch(e) {}
    if (fillInput( id('dtlLostPPT_ctl00_tbxLOST_PPT_NUM'),  data.passportLostNumber))       ok++;
    if (fillSelect(id('dtlLostPPT_ctl00_ddlLOST_PPT_NATL'), 'MEX'))                         ok++;
    if (fillInput( id('dtlLostPPT_ctl00_tbxLOST_PPT_EXPL'), data.passportLostExplanation))  ok++;
  } else {
    fillRadio(id('rblLOST_PPT_IND_1'));
  }
  console.log(`[VP] Passport: ${ok}`); return ok;
}


// ── CONTACT — Dirección de Contacto en los EUA ──────────

async function fillContact(data) {
  let ok = 0;
  if (data.usContactHotel) {
    fillCheckbox(id('cbxUS_POC_NAME_NA'), true);
    if (fillInput(id('tbxUS_POC_ORGANIZATION'), data.usContactHotel)) ok++;
    fillCheckbox(id('cbxUS_POC_ORG_NA_IND'), false);
  } else {
    if (fillInput(id('tbxUS_POC_GIVEN_NAME'), data.usContactFirstName)) ok++;
    if (fillInput(id('tbxUS_POC_SURNAME'),    data.usContactLastName))  ok++;
    fillCheckbox(id('cbxUS_POC_ORG_NA_IND'), true);
  }
  if (fillSelect(id('ddlUS_POC_REL_TO_APP'),      data.usContactRelationship)) ok++;
  if (fillInput( id('tbxUS_POC_ADDR_LN1'),         data.usContactStreet))      ok++;
  if (fillInput( id('tbxUS_POC_ADDR_CITY'),         data.usContactCity))        ok++;
  if (fillSelect(id('ddlUS_POC_ADDR_STATE'),        data.usContactState))       ok++;
  if (fillInput( id('lblUS_POC_ADDR_POSTAL_CDExample'), data.usContactZip))     ok++;
  if (fillInput( id('tbxUS_POC_HOME_TEL'),          data.usContactPhone))       ok++;
  fillCheckbox(id('cbexUS_POC_EMAIL_ADDR_NA'), true);
  console.log(`[VP] Contact: ${ok}`); return ok;
}


// ── FAMILY — Familia ─────────────────────────────────────

async function fillFamily(data) {
  let ok = 0;
  if (fillInput( id('tbxFATHER_GIVEN_NAME'), data.fatherFirstName)) ok++;
  if (fillInput( id('tbxFATHER_SURNAME'),    data.fatherLastName))  ok++;
  if (fillSelect(id('ddlFathersDOBDay'),     data.fatherDob_day))   ok++;
  if (fillSelect(id('ddlFathersDOBMonth'),   data.fatherDob_month)) ok++;
  if (fillInput( id('tbxFathersDOBYear'),    data.fatherDob_year))  ok++;
  fillRadio(id('rblFATHER_LIVE_IN_US_IND_1'));
  if (fillInput( id('tbxMOTHER_GIVEN_NAME'), data.motherFirstName)) ok++;
  if (fillInput( id('tbxMOTHER_SURNAME'),    data.motherLastName))  ok++;
  if (fillSelect(id('ddlMothersDOBDay'),     data.motherDob_day))   ok++;
  if (fillSelect(id('ddlMothersDOBMonth'),   data.motherDob_month)) ok++;
  if (fillInput( id('tbxMothersDOBYear'),    data.motherDob_year))  ok++;
  fillRadio(id('rblMOTHER_LIVE_IN_US_IND_1'));
  if (data.usRelativeFirstName) {
    fillRadio(id('rblUS_IMMED_RELATIVE_IND_0'));
    try { await waitFor(id('dlUSRelatives_ctl00_tbxUS_REL_GIVEN_NAME')); } catch(e) {}
    if (fillInput( id('dlUSRelatives_ctl00_tbxUS_REL_GIVEN_NAME'), data.usRelativeFirstName))    ok++;
    if (fillInput( id('dlUSRelatives_ctl00_tbxUS_REL_SURNAME'),    data.usRelativeLastName))     ok++;
    if (fillSelect(id('dlUSRelatives_ctl00_ddlUS_REL_TYPE'),       data.usRelativeRelationship)) ok++;
    if (fillSelect(id('dlUSRelatives_ctl00_ddlUS_REL_STATUS'),     data.usRelativeStatus))       ok++;
  } else {
    fillRadio(id('rblUS_IMMED_RELATIVE_IND_1'));
  }
  const hasOther = (data.hasOtherUSRelative || '').toLowerCase();
  fillRadio(id(hasOther === 'si' || hasOther === 'sí' || hasOther === 'yes'
    ? 'rblUS_OTHER_RELATIVE_IND_0'
    : 'rblUS_OTHER_RELATIVE_IND_1'));
  console.log(`[VP] Family: ${ok}`); return ok;
}


// ── SPOUSE — Pareja ──────────────────────────────────────

async function fillSpouse(data) {
  let ok = 0;
  // Solo se ejecuta si hay datos de pareja (estado civil casado/unión libre)
  if (!data.spouseFirstName) {
    console.log('[VP] Spouse: sin datos de pareja'); return 0;
  }
  try { await waitFor(id('tbxSpouseGivenName')); } catch(e) {}
  if (fillInput( id('tbxSpouseGivenName'),      data.spouseFirstName))    ok++;
  if (fillInput( id('tbxSpouseSurname'),         data.spouseLastName))    ok++;
  if (fillSelect(id('ddlSpouseNatDropDownList'), data.spouseNationality)) ok++;
  if (fillSelect(id('ddlDOBDay'),   data.spouseDob_day))   ok++;
  if (fillSelect(id('ddlDOBMonth'), data.spouseDob_month)) ok++;
  if (fillInput( id('tbxDOBYear'),  data.spouseDob_year))  ok++;
  if (fillInput( id('tbxSpousePOBCity'),      data.spouseBirthCity))    ok++;
  if (fillSelect(id('ddlSpousePOBCountry'),   data.spouseBirthCountry)) ok++;
  fillSelect(id('ddlSpouseAddressType'), 'H');
  console.log(`[VP] Spouse: ${ok}`); return ok;
}


// ── WORK — Trabajo actual ────────────────────────────────

async function fillWork(data) {
  let ok = 0;
  // ddlPresentOccupation → siempre "O" (Other) para usar campo de texto libre
  if (fillSelect(id('ddlPresentOccupation'), 'O')) ok++;
  try { await waitFor(id('tbxExplainOtherPresentOccupation')); } catch(e) {}
  if (fillInput(id('tbxExplainOtherPresentOccupation'), data.occupation)) ok++;
  if (fillInput(id('tbxEmpSchName'),              data.employer))   ok++;
  if (fillInput(id('tbxEmpSchAddr1'),             data.workStreet)) ok++;
  if (fillInput(id('tbxEmpSchCity'),              data.workCity))   ok++;
  if (fillInput(id('tbxWORK_EDUC_ADDR_STATE'),    data.workState))  ok++;
  if (fillInput(id('tbxWORK_EDUC_ADDR_POSTAL_CD'),data.workZip))    ok++;
  if (fillInput(id('tbxWORK_EDUC_TEL'),           data.workPhone))  ok++;
  if (fillSelect(id('ddlEmpSchCountry'), 'MEX')) ok++;
  if (fillSelect(id('ddlEmpDateFromDay'),   data.workStart_day))   ok++;
  if (fillSelect(id('ddlEmpDateFromMonth'), data.workStart_month)) ok++;
  if (fillInput( id('tbxEmpDateFromYear'), data.workStart_year))   ok++;
  if (data.workSalary) {
    if (fillInput(id('tbxCURR_MONTHLY_SALARY'), data.workSalary)) ok++;
  } else {
    fillCheckbox(id('cbxCURR_MONTHLY_SALARY_NA'), true);
  }
  if (fillInput(id('tbxDescribeDuties'), data.workDuties)) ok++;
  console.log(`[VP] Work: ${ok}`); return ok;
}


// ── WORK PREV — Trabajo anterior / Estudios ─────────────

async function fillWorkPrev(data) {
  let ok = 0;
  if (data.prevEmployer) {
    fillRadio(id('rblPreviouslyEmployed_0'));
    try { await waitFor(id('dtlPrevEmpl_ctl00_tbEmployerName')); } catch(e) {}
    if (fillInput( id('dtlPrevEmpl_ctl00_tbEmployerName'),              data.prevEmployer))      ok++;
    if (fillInput( id('dtlPrevEmpl_ctl00_tbEmployerStreetAddress1'),    data.prevWorkStreet))    ok++;
    if (fillInput( id('dtlPrevEmpl_ctl00_tbEmployerCity'),              data.prevWorkCity))      ok++;
    if (fillInput( id('dtlPrevEmpl_ctl00_tbxPREV_EMPL_ADDR_STATE'),    data.prevWorkState))     ok++;
    if (fillInput( id('dtlPrevEmpl_ctl00_tbxPREV_EMPL_ADDR_POSTAL_CD'),data.prevWorkZip))       ok++;
    if (fillSelect(id('dtlPrevEmpl_ctl00_DropDownList2'),               data.prevWorkCountry))   ok++;
    if (fillInput( id('dtlPrevEmpl_ctl00_tbEmployerPhone'),             data.prevWorkPhone))     ok++;
    if (fillInput( id('dtlPrevEmpl_ctl00_tbJobTitle'),                  data.prevJobTitle))      ok++;
    if (data.prevSupervisorFirst) {
      if (fillInput(id('dtlPrevEmpl_ctl00_tbSupervisorGivenName'), data.prevSupervisorFirst)) ok++;
    } else {
      fillCheckbox(id('dtlPrevEmpl_ctl00_cbxSupervisorGivenName_NA'), true);
    }
    if (data.prevSupervisorLast) {
      if (fillInput(id('dtlPrevEmpl_ctl00_tbSupervisorSurname'), data.prevSupervisorLast)) ok++;
    } else {
      fillCheckbox(id('dtlPrevEmpl_ctl00_cbxSupervisorSurname_NA'), true);
    }
    if (fillSelect(id('dtlPrevEmpl_ctl00_ddlEmpDateFromDay'),   data.prevWorkStart_day))   ok++;
    if (fillSelect(id('dtlPrevEmpl_ctl00_ddlEmpDateFromMonth'), data.prevWorkStart_month)) ok++;
    if (fillInput( id('dtlPrevEmpl_ctl00_tbxEmpDateFromYear'),  data.prevWorkStart_year))  ok++;
    if (fillSelect(id('dtlPrevEmpl_ctl00_ddlEmpDateToDay'),     data.prevWorkEnd_day))     ok++;
    if (fillSelect(id('dtlPrevEmpl_ctl00_ddlEmpDateToMonth'),   data.prevWorkEnd_month))   ok++;
    if (fillInput( id('dtlPrevEmpl_ctl00_tbxEmpDateToYear'),    data.prevWorkEnd_year))    ok++;
    if (fillInput( id('dtlPrevEmpl_ctl00_tbDescribeDuties'),    data.prevWorkDuties))      ok++;
  } else {
    fillRadio(id('rblPreviouslyEmployed_1'));
  }
  if (data.schoolName) {
    fillRadio(id('rblOtherEduc_0'));
    try { await waitFor(id('dtlPrevEduc_ctl00_tbxSchoolName')); } catch(e) {}
    if (fillInput( id('dtlPrevEduc_ctl00_tbxSchoolName'),          data.schoolName))    ok++;
    if (fillInput( id('dtlPrevEduc_ctl00_tbxSchoolAddr1'),          data.schoolStreet))  ok++;
    if (fillInput( id('dtlPrevEduc_ctl00_tbxSchoolCity'),           data.schoolCity))    ok++;
    if (fillInput( id('dtlPrevEduc_ctl00_tbxEDUC_INST_ADDR_STATE'), data.schoolState))  ok++;
    if (fillInput( id('dtlPrevEduc_ctl00_tbxEDUC_INST_POSTAL_CD'),  data.schoolZip))    ok++;
    if (fillSelect(id('dtlPrevEduc_ctl00_ddlSchoolCountry'),         data.schoolCountry))ok++;
    if (fillInput( id('dtlPrevEduc_ctl00_tbxSchoolCourseOfStudy'),   data.schoolCourse)) ok++;
    if (fillSelect(id('dtlPrevEduc_ctl00_ddlSchoolFromDay'),         data.schoolStart_day))   ok++;
    if (fillSelect(id('dtlPrevEduc_ctl00_ddlSchoolFromMonth'),       data.schoolStart_month)) ok++;
    if (fillInput( id('dtlPrevEduc_ctl00_tbxSchoolFromYear'),        data.schoolStart_year))  ok++;
    if (fillSelect(id('dtlPrevEduc_ctl00_ddlSchoolToDay'),           data.schoolEnd_day))     ok++;
    if (fillSelect(id('dtlPrevEduc_ctl00_ddlSchoolToMonth'),         data.schoolEnd_month))   ok++;
    if (fillInput( id('dtlPrevEduc_ctl00_tbxSchoolToYear'),          data.schoolEnd_year))    ok++;
  } else {
    fillRadio(id('rblOtherEduc_1'));
  }
  console.log(`[VP] WorkPrev: ${ok}`); return ok;
}


// ── SECURITY — Adicional / Seguridad ────────────────────

async function fillSecurity(data) {
  let ok = 0;
  fillRadio(id('rblCLAN_TRIBE_IND_1'));

  // Idiomas
  if (data.language1) {
    if (fillInput(id('dtlLANGUAGES_ctl00_tbxLANGUAGE_NAME'), data.language1)) {
      ok++;
      document.getElementById(id('dtlLANGUAGES_ctl00_InsertButtonLANGUAGE'))?.click();
    }
  }
  if (data.language2) {
    try { await waitFor(id('dtlLANGUAGES_ctl01_tbxLANGUAGE_NAME')); } catch(e) {}
    if (fillInput(id('dtlLANGUAGES_ctl01_tbxLANGUAGE_NAME'), data.language2)) {
      ok++;
      document.getElementById(id('dtlLANGUAGES_ctl01_InsertButtonLANGUAGE'))?.click();
    }
  }
  if (data.language3) {
    try { await waitFor(id('dtlLANGUAGES_ctl02_tbxLANGUAGE_NAME')); } catch(e) {}
    if (fillInput(id('dtlLANGUAGES_ctl02_tbxLANGUAGE_NAME'), data.language3)) ok++;
  }

  // Países visitados
  if (data.country1) {
    fillRadio(id('rblCOUNTRIES_VISITED_IND_0'));
    try { await waitFor(id('dtlCountriesVisited_ctl00_ddlCOUNTRIES_VISITED')); } catch(e) {}
    if (fillSelect(id('dtlCountriesVisited_ctl00_ddlCOUNTRIES_VISITED'), data.country1)) {
      ok++;
      document.getElementById(id('dtlCountriesVisited_ctl00_InsertButtonCountriesVisited'))?.click();
    }
  } else {
    fillRadio(id('rblCOUNTRIES_VISITED_IND_1'));
  }
  if (data.country2) {
    try { await waitFor(id('dtlCountriesVisited_ctl01_ddlCOUNTRIES_VISITED')); } catch(e) {}
    if (fillSelect(id('dtlCountriesVisited_ctl01_ddlCOUNTRIES_VISITED'), data.country2)) {
      ok++;
      document.getElementById(id('dtlCountriesVisited_ctl01_InsertButtonCountriesVisited'))?.click();
    }
  }
  if (data.country3) {
    try { await waitFor(id('dtlCountriesVisited_ctl02_ddlCOUNTRIES_VISITED')); } catch(e) {}
    if (fillSelect(id('dtlCountriesVisited_ctl02_ddlCOUNTRIES_VISITED'), data.country3)) ok++;
  }

  // Preguntas de seguridad — todas No
  for (const r of [
    'rblORGANIZATION_IND_1','rblSPECIALIZED_SKILLS_IND_1','rblMILITARY_SERVICE_IND_1',
    'rblINSURGENT_ORG_IND_1','rblDisease_1','rblDisorder_1','rblDruguser_1',
    'rblArrested_1','rblControlledSubstances_1','rblProstitution_1','rblMoneyLaundering_1',
    'rblHumanTrafficking_1','rblAssistedSevereTrafficking_1','rblHumanTraffickingRelated_1',
    'rblIllegalActivity_1','rblTerroristActivity_1','rblTerroristSupport_1',
    'rblTerroristOrg_1','rblTerroristRel_1','rblGenocide_1','rblTorture_1',
    'rblExViolence_1','rblChildSoldier_1','rblReligiousFreedom_1','rblPopulationControls_1',
    'rblTransplant_1','rblImmigrationFraud_1','rblDeport_1','rblChildCustody_1',
    'rblVotingViolation_1','rblRenounceExp_1',
  ]) { fillRadio(id(r)); }

  console.log(`[VP] Security: ${ok}`); return ok;
}


// ── Router ───────────────────────────────────────────────

const SECTION_HANDLERS = {
  pi1:        data => Promise.resolve(fillPI1(data)),
  pi2:        data => Promise.resolve(fillPI2(data)),
  travel:     fillTravel,
  companions: fillCompanions,
  prevTravel: fillPrevTravel,
  address:    data => Promise.resolve(fillAddress(data)),
  passport:   fillPassport,
  contact:    fillContact,
  family:     fillFamily,
  spouse:     fillSpouse,
  work:       fillWork,
  workPrev:   fillWorkPrev,
  security:   fillSecurity,
};


// ── Listener ─────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action !== 'fill') return;
  chrome.storage.local.get('visasproClientData', async result => {
    const data = result.visasproClientData;
    if (!data) { sendResponse({ ok: false, error: 'No hay datos de cliente.' }); return; }
    const handler = SECTION_HANDLERS[message.section];
    if (!handler) { sendResponse({ ok: false, error: `Sección desconocida: ${message.section}` }); return; }
    try {
      const filled = await handler(data);
      sendResponse({ ok: true, filled });
    } catch (err) {
      console.error('[VP] Error:', err);
      sendResponse({ ok: false, error: err.message });
    }
  });
  return true;
});

console.log('[VisasPro] Content script activo en:', window.location.href);
