window.ERMStorage = (() => {
  const STORAGE_KEY = 'erm-proyecta-state-v1';

  let backend = null;
  const readRaw = () => (backend ? backend.read() : localStorage.getItem(STORAGE_KEY));

  const deepClone = (value) => JSON.parse(JSON.stringify(value));
  const normalizeAttachments = (source) => {
    const items = Array.isArray(source) ? source : [];
    return items
      .map((item) => ({
        id: String(item?.id || `att-${Math.random().toString(36).slice(2, 8)}`),
        fileName: String(item?.fileName || item?.originalName || 'documento.pdf'),
        mimeType: String(item?.mimeType || 'application/octet-stream'),
        sizeBytes: Math.max(0, Number(item?.sizeBytes || 0) || 0),
        sizeKb: Number(item?.sizeKb || Math.round((Number(item?.sizeBytes || 0) || 0) / 1024) || 0) || 0,
        storagePath: String(item?.storagePath || ''),
        dataUrl: String(item?.dataUrl || ''),
        createdAt: String(item?.createdAt || new Date().toISOString()),
        category: String(item?.category || '')
      }))
      .filter((item) => item.fileName && (item.storagePath || item.dataUrl));
  };

  // El modo "utilidad objetivo" se eliminó. Para no cambiarle el precio a una OT que lo usaba,
  // se convierte en "precio definido" con el mismo neto que tenía guardado.
  function normalizeQuotePriceMode(quote, ivaRate) {
    if (!quote) return quote;
    if (quote.selectedPriceMode === 'target') {
      const net = Number(quote.selectedPriceNet) || 0;
      if (net > 0) {
        quote.selectedPriceMode = 'custom';
        quote.customPriceGross = Math.round(net * (1 + Math.max(0, Number(ivaRate) || 0)));
      } else {
        quote.selectedPriceMode = 'minimum';
      }
    }
    return quote;
  }

  // ---- Base de costo neta (Política de precios v1, 19-11-2026) ----
  // Desde ahora baseCost es siempre el NETO y purchaseDoc dice cómo se compra (boleta / factura / exento).
  // Los insumos de antes no traen purchaseDoc y su baseCost puede ser con IVA o ya neto (se corrigieron a
  // mano en distintas fechas). Por eso NO se convierten solos: quedan "por revisar" con su costo de siempre
  // (ERMCalc.materialCosts usa su unitCost tal cual) hasta que en Base de datos se elige, uno por uno, si el
  // valor guardado es con IVA o neto (convertLegacyMaterial). Solo se aplican solas las correcciones seguras.
  const NET_BASIS_BACKUP_KEY = 'erm-proyecta-respaldo-materiales-pre-neto';
  // Correcciones pedidas (19-11-2026), por id de la base de Andiworks.
  const NET_BASIS_FIXES = {
    // Láser como servicio solicitado: el costo interno es $150/min y $350/min es el precio de lista.
    'mat-ttkjrl7': { baseCost: 150, listPrice: 350 },
    'mat-wdfb8s3': { baseCost: 150, listPrice: 350 }
  };
  // Valores que se sabe que ya están en neto (propuesta por defecto en la revisión).
  const NET_BASIS_KNOWN_NET = ['mat-qkw70fz'];
  const NET_BASIS_RENAME = { 'mat-qkw70fz': 'Acrílico Color 3mm' };
  // Acrílico Color 3mm antiguo ($47.124): se elimina si ninguna OT lo usa.
  const NET_BASIS_REMOVE = ['mat-pzu4u2z'];

  function parseClp(text) {
    const clean = String(text || '').replace(/\$/g, '').replace(/\./g, '').replace(',', '.').trim();
    const value = Number(clean);
    return Number.isFinite(value) ? value : 0;
  }

  // Quita de las notas las líneas sobre IVA ("Precio con IVA incluido", "sin IVA = $…"):
  // eso ahora vive en los campos de precio neto, precio con IVA y forma de compra.
  function cleanIvaNotes(notes) {
    return String(notes || '')
      .split(/\r?\n/)
      .filter((lineText) => !/\b(con|sin)\s+iva\b/i.test(lineText))
      .join('\n')
      .trim();
  }

  function isPendingNetReview(item) {
    return Boolean(item) && !item.purchaseDoc;
  }

  // Propuesta para la revisión: neto escrito en la nota ("sin IVA = $7.964") o si el valor ya es neto.
  function suggestLegacyNet(item) {
    const noteNet = parseClp((String(item?.notes || '').match(/sin\s+iva\s*=?\s*\$+\s*([\d.,]+)/i) || [])[1]);
    return {
      noteNet: noteNet > 0 ? Math.round(noteNet) : 0,
      valueIs: NET_BASIS_KNOWN_NET.includes(item?.id) ? 'neto' : 'conIva'
    };
  }

  // Pasa un insumo antiguo a la base neta. valueIs: 'conIva' (el valor guardado es lo pagado con IVA) o
  // 'neto' (ya es sin IVA). purchaseDoc: cómo se compra. netOverride: neto escrito a mano (opcional).
  function convertLegacyMaterial(item, valueIs, purchaseDoc, ivaRate, netOverride) {
    const iva = 1 + Math.max(0, Number(ivaRate) || 0);
    const stored = Number(item.baseCost) || 0;
    const isService = item.calculationUnit === 'min';
    const manualNet = Number(netOverride) || 0;
    const baseCost = manualNet > 0 ? Math.round(manualNet) : (isService || valueIs === 'neto' ? stored : Math.round(stored / iva));
    const converted = {
      ...item,
      baseCost,
      purchaseDoc: isService ? 'exento' : (['boleta', 'factura', 'exento'].includes(purchaseDoc) ? purchaseDoc : 'boleta'),
      listPrice: Number(item.listPrice) || 0,
      notes: cleanIvaNotes(item.notes),
      netReviewedAt: new Date().toISOString()
    };
    if (window.ERMCalc?.materialCosts) {
      const costs = window.ERMCalc.materialCosts(converted, iva - 1);
      converted.unitCostNet = costs.unitCostNet;
      converted.unitCost = costs.unitCost;
    }
    return converted;
  }

  function refreshCostBasis(database) {
    const materials = database.materials || [];
    database.costBasis = materials.some(isPendingNetReview) ? 'pendiente' : 'neto';
    return database.costBasis;
  }

  function migrateMaterialsToNetBasis(state) {
    const database = state.database || {};
    if (database.costBasis === 'neto') return;
    const ivaRate = Number(state.scenario?.ivaRate ?? 0.19);
    const materials = database.materials || [];

    if (materials.length) {
      try {
        if (!localStorage.getItem(NET_BASIS_BACKUP_KEY)) {
          const slim = materials.map(({ imageDataUrl, ...rest }) => rest);
          localStorage.setItem(NET_BASIS_BACKUP_KEY, JSON.stringify({ savedAt: new Date().toISOString(), materials: slim }));
        }
      } catch (error) {
        console.warn('No se pudo guardar el respaldo de materiales antes de pasar a neto.', error);
      }
    }

    const usedIds = new Set();
    (state.orders || []).forEach((order) => (order?.quote?.materials || []).forEach((line) => usedIds.add(line.materialId)));
    (state.quote?.materials || []).forEach((line) => usedIds.add(line.materialId));

    database.materials = materials
      .filter((item) => !(NET_BASIS_REMOVE.includes(item.id) && !usedIds.has(item.id)))
      .map((item) => {
        if (!isPendingNetReview(item)) return item;
        const renamed = NET_BASIS_RENAME[item.id] ? { ...item, name: NET_BASIS_RENAME[item.id] } : item;
        // Servicios por minuto (láser propio, servicios): no llevan IVA, se convierten sin preguntar.
        if (renamed.calculationUnit !== 'min') return renamed;
        const fix = NET_BASIS_FIXES[renamed.id] || {};
        const converted = convertLegacyMaterial({ ...renamed, ...(fix.baseCost !== undefined ? { baseCost: fix.baseCost } : {}) }, 'neto', 'exento', ivaRate);
        if (fix.listPrice !== undefined) converted.listPrice = fix.listPrice;
        return converted;
      });

    refreshCostBasis(database);
    state.database = database;
  }

  function load() {
    try {
      const raw = readRaw();
      if (!raw) return deepClone(window.ERMDefaults);
      const parsed = JSON.parse(raw);
      const state = {
        ...deepClone(window.ERMDefaults),
        ...parsed,
        scenario: {
          ...deepClone(window.ERMDefaults.scenario),
          ...(parsed.scenario || {}),
          projection: {
            ...deepClone(window.ERMDefaults.scenario.projection),
            ...(parsed.scenario?.projection || {})
          }
        },
        quote: {
          ...deepClone(window.ERMDefaults.quote),
          ...(parsed.quote || {}),
          attachments: normalizeAttachments(parsed.quote?.attachments || []),
          logistics: {
            ...deepClone(window.ERMDefaults.quote.logistics),
            ...(parsed.quote?.logistics || {})
          }
        },
        database: {
          ...deepClone(window.ERMDefaults.database),
          ...(parsed.database || {}),
          materials: Array.isArray(parsed.database?.materials)
            ? parsed.database.materials
            : deepClone(window.ERMDefaults.database.materials),
          productTypes: Array.isArray(parsed.database?.productTypes)
            ? parsed.database.productTypes
            : deepClone(window.ERMDefaults.database.productTypes),
          externalResources: Array.isArray(parsed.database?.externalResources)
            ? parsed.database.externalResources
            : deepClone(window.ERMDefaults.database.externalResources)
        },
        inventory: {
          ...deepClone(window.ERMDefaults.inventory),
          ...(parsed.inventory || {}),
          desiredItems: Array.isArray(parsed.inventory?.desiredItems)
            ? parsed.inventory.desiredItems
            : deepClone(window.ERMDefaults.inventory.desiredItems)
        },
        expenses: {
          ...deepClone(window.ERMDefaults.expenses),
          ...(parsed.expenses || {}),
          cards: Array.isArray(parsed.expenses?.cards)
            ? parsed.expenses.cards
            : deepClone(window.ERMDefaults.expenses.cards)
        },
        contacts: Array.isArray(parsed.contacts)
          ? parsed.contacts.map((item) => ({ ...item, isFriend: Boolean(item?.isFriend) }))
          : deepClone(window.ERMDefaults.contacts),
        orders: Array.isArray(parsed.orders) ? parsed.orders : deepClone(window.ERMDefaults.orders),
        finance: {
          ...deepClone(window.ERMDefaults.finance),
          ...(parsed.finance || {}),
          entries: Array.isArray(parsed.finance?.entries)
            ? parsed.finance.entries
            : deepClone(window.ERMDefaults.finance.entries)
        },
        attendance: {
          ...deepClone(window.ERMDefaults.attendance),
          ...(parsed.attendance || {}),
          records: Array.isArray(parsed.attendance?.records)
            ? parsed.attendance.records
            : deepClone(window.ERMDefaults.attendance.records)
        },
        ui: {
          ...deepClone(window.ERMDefaults.ui),
          ...(parsed.ui || {}),
          activityLog: Array.isArray(parsed.ui?.activityLog) ? parsed.ui.activityLog.slice(0, 40) : []
        }
      };

      const legacyFixedCosts = ['Internet y software', 'Mantención de equipos'];
      const hasLegacyScenario = (parsed.scenario?.fixedCosts || []).some((item) => legacyFixedCosts.includes(item.name))
        || (parsed.scenario?.employees || []).some((item) => item.name === 'Apoyo Producción');

      if (hasLegacyScenario) {
        state.scenario.fixedCosts = deepClone(window.ERMDefaults.scenario.fixedCosts);
        state.scenario.employees = deepClone(window.ERMDefaults.scenario.employees);
      }

      const requiredFixedCosts = [
        { name: 'Deterioro y mantención de herramientas', periodicity: 'anual', amount: 300000 },
        { name: 'Consumibles no trazados', periodicity: 'mensual', amount: 20000 },
        { name: 'Limpieza y orden', periodicity: 'mensual', amount: 15000 }
      ];

      // Meta anual de ventas netas fijada a mano (0 = se calcula desde el escenario).
      state.scenario.annualSalesGoal = Math.max(0, Number(state.scenario.annualSalesGoal) || 0);
      // Enlaces: solo http(s); si nunca se guardaron, quedan los de ejemplo.
      state.scenario.links = (Array.isArray(parsed.scenario?.links) ? parsed.scenario.links : deepClone(window.ERMDefaults.scenario.links))
        .filter((item) => item && /^https?:\/\//i.test(String(item.url || '')) && String(item.name || '').trim())
        .map((item) => ({
          id: item.id || `lnk-${Math.random().toString(36).slice(2, 8)}`,
          group: String(item.group || 'General').trim() || 'General',
          name: String(item.name).trim(),
          url: String(item.url).trim(),
          pinned: Boolean(item.pinned)
        }));

      requiredFixedCosts.forEach((required) => {
        const exists = (state.scenario.fixedCosts || []).some((item) => item.name === required.name);
        if (!exists) {
          state.scenario.fixedCosts.push({
            id: `fc-${Math.random().toString(36).slice(2, 8)}`,
            ...required
          });
        }
      });

      const demoMaterialIds = [
        'mat-pino-finger-18',
        'mat-acrilico-negro-3mm',
        'mat-mdf-15',
        'srv-corte-cnc',
        'srv-pintura-aerosol',
        'acc-tornillos',
        'con-lija',
        'con-masking'
      ];

      const currentMaterials = state.database.materials || [];
      const onlyDemoMaterials = currentMaterials.length > 0 && currentMaterials.every((item) => demoMaterialIds.includes(item.id));

      state.database.materials = onlyDemoMaterials ? [] : currentMaterials.map((item) => ({
        ...item,
        group: (item.group === 'Material' ? 'Placas' : item.group) || 'Placas',
        calculationUnit: item.calculationUnit || 'unidad',
        baseCost: Number(item.baseCost ?? item.unitCost ?? 0) || 0,
        unit: item.unit || 'unidad',
        unitCost: Number(item.unitCost ?? item.baseCost ?? 0) || 0,
        notes: item.notes || '',
        createdAt: item.createdAt || item.Fecha || new Date().toLocaleDateString('es-CL'),
        imageDataUrl: item.imageDataUrl || item.image || '',
        imageName: item.imageName || '',
        imageMimeType: item.imageMimeType || '',
        imageSizeKb: Number(item.imageSizeKb || 0) || 0
      }));

      migrateMaterialsToNetBasis(state);

      if (state.ui.databaseFilter === 'Material') {
        state.ui.databaseFilter = 'Placas';
      }

      if (!state.quote.selectedPriceMode) {
        state.quote.selectedPriceMode = 'minimum';
      }

      // Gastos fijos: 'real' (sale plata) u 'oportunidad' (ej. arriendo de local propio).
      state.scenario.fixedCosts = (state.scenario.fixedCosts || []).map((item) => ({
        ...item,
        costType: item.costType === 'oportunidad' || item.costType === 'real'
          ? item.costType
          : (/arriendo/i.test(String(item.name || '')) ? 'oportunidad' : 'real')
      }));

      if (state.ui.databaseSection !== 'materials' && state.ui.databaseSection !== 'productTypes' && state.ui.databaseSection !== 'externalResources') {
        state.ui.databaseSection = 'materials';
      }

      if (state.ui.inventorySection !== 'company' && state.ui.inventorySection !== 'desired') {
        state.ui.inventorySection = 'company';
      }

      const baseUpdateKeys = [
        'baseScenarioUpdatedAt',
        'baseDatabaseUpdatedAt',
        'baseProductTypesUpdatedAt',
        'baseExternalUpdatedAt',
        'baseContactsUpdatedAt',
        'baseOrdersUpdatedAt',
        'baseExpensesUpdatedAt',
        'baseDesiredUpdatedAt',
        'baseAttendanceUpdatedAt',
        'baseFinanceUpdatedAt'
      ];
      baseUpdateKeys.forEach((key) => {
        if (!state.ui[key]) state.ui[key] = null;
      });

      const entryCountByPeriod = {
        mensual: 12,
        trimestral: 4,
        semestral: 2,
        anual: 1
      };

      const createEntry = (index) => ({
        id: `exp-entry-${Math.random().toString(36).slice(2, 8)}`,
        label: `Cuota ${index + 1}`,
        amount: 0,
        date: '',
        status: 'no-pagado',
        notes: '',
        pdfDataUrl: '',
        pdfName: '',
        pdfMimeType: '',
        pdfSizeKb: 0
      });

      state.expenses.cards = (state.expenses.cards || []).map((card) => {
        const period = ['mensual', 'trimestral', 'semestral', 'anual'].includes(card?.period) ? card.period : 'mensual';
        const expectedCount = entryCountByPeriod[period] || 12;
        const sourceEntries = Array.isArray(card?.entries) ? card.entries : [];
        const normalizedEntries = Array.from({ length: expectedCount }, (_, index) => {
          const source = sourceEntries[index] || createEntry(index);
          return {
            ...createEntry(index),
            ...source,
            label: source.label || `Cuota ${index + 1}`,
            amount: Number(source.amount || 0) || 0,
            status: source.status === 'pagado' ? 'pagado' : 'no-pagado',
            notes: String(source.notes || ''),
            attachments: normalizeAttachments(source.attachments || []),
            pdfDataUrl: source.pdfDataUrl || '',
            pdfName: source.pdfName || '',
            pdfMimeType: source.pdfMimeType || '',
            pdfSizeKb: Number(source.pdfSizeKb || 0) || 0
          };
        });

        return {
          id: card.id || `exp-card-${Math.random().toString(36).slice(2, 8)}`,
          name: String(card.name || '').trim() || 'Gasto sin titulo',
          color: card.color || '#1f8d8a',
          description: String(card.description || ''),
          baseYear: String(card.baseYear || new Date().getFullYear()),
          period,
          expenseType: String(card.expenseType || ''),
          // Vencimiento: día del mes (0 = sin día fijo) y mes de la primera cuota.
          dueDay: Math.min(31, Math.max(0, Math.round(Number(card.dueDay) || 0))),
          firstDueMonth: Math.min(12, Math.max(1, Math.round(Number(card.firstDueMonth) || 1))),
          entries: normalizedEntries
        };
      });

      if (!state.expenses.cards.length) {
        state.expenses.cards = deepClone(window.ERMDefaults.expenses.cards);
      }

      if (state.quote.customPriceGross === undefined || state.quote.customPriceGross === null) {
        state.quote.customPriceGross = 0;
      }

      {
        const parsedQty = Math.round(Number(state.quote.pieceQuantity));
        state.quote.pieceQuantity = Number.isFinite(parsedQty) && parsedQty >= 1 ? parsedQty : 1;
      }

      normalizeQuotePriceMode(state.quote, state.scenario?.ivaRate);

      if (state.quote.selectedPriceMode === 'custom' && !(Number(state.quote.customPriceGross) > 0) && Number(state.quote.selectedPriceNet) > 0) {
        const ivaMultiplier = 1 + Math.max(0, Number(state.scenario?.ivaRate) || 0);
        state.quote.customPriceGross = Math.round(Number(state.quote.selectedPriceNet) * ivaMultiplier);
      }

      state.database.productTypes = (state.database.productTypes || []).map((item) => ({
        id: item.id || `ptype-${Math.random().toString(36).slice(2, 8)}`,
        name: String(item.name || '').trim(),
        createdAt: item.createdAt || new Date().toLocaleDateString('es-CL'),
        comments: item.comments || ''
      })).filter((item) => item.name);

      // Se conservan todos los campos (teléfono, redes, correo, web); antes se perdían al recargar.
      state.database.externalResources = (state.database.externalResources || []).map((item) => ({
        ...item,
        id: item.id || `ext-${Math.random().toString(36).slice(2, 8)}`,
        type: item.type || 'ayuda',
        name: String(item.name || '').trim(),
        hourlyRate: Number(item.hourlyRate || 0) || 0,
        description: item.description || '',
        address: String(item.address || ''),
        district: String(item.district || ''),
        status: item.status || 'Activo',
        createdAt: item.createdAt || new Date().toLocaleDateString('es-CL')
      })).filter((item) => item.name);

      state.inventory.desiredItems = (state.inventory.desiredItems || []).map((item) => {
        const notes = String(item.notes || item.description || '');
        const purchaseDate = item.purchaseDate || item.entryDate || new Date().toISOString().slice(0, 10);
        return {
        id: item.id || `des-${Math.random().toString(36).slice(2, 8)}`,
        name: String(item.name || '').trim(),
        sku: String(item.sku || ''),
        category: String(item.category || ''),
        brand: String(item.brand || ''),
        model: item.model || '',
        status: item.status || 'Operativo',
        purchaseDate,
        supplier: String(item.supplier || ''),
        cost: Number(item.cost || 0) || 0,
        location: String(item.location || ''),
        notes,
        description: notes,
        entryDate: purchaseDate,
        imageDataUrl: item.imageDataUrl || '',
        imageName: item.imageName || '',
        imageMimeType: item.imageMimeType || '',
        imageSizeKb: Number(item.imageSizeKb || 0) || 0,
        expanded: Boolean(item.expanded),
        maintenanceEveryDays: Math.max(0, Number(item.maintenanceEveryDays) || 0),
        lastMaintenanceDate: String(item.lastMaintenanceDate || ''),
        offers: Array.isArray(item.offers) ? item.offers.map((offer) => ({
          id: offer.id || `off-${Math.random().toString(36).slice(2, 8)}`,
          price: Number(offer.price || 0) || 0,
          link: offer.link || '',
          entryDate: offer.entryDate || new Date().toISOString().slice(0, 10)
        })) : []
        };
      }).filter((item) => item.name);

      state.inventory.wishItems = (Array.isArray(state.inventory.wishItems) ? state.inventory.wishItems : [])
        .filter((item) => item && String(item.name || '').trim())
        .map((item) => ({
          id: item.id || `wish-${Math.random().toString(36).slice(2, 8)}`,
          name: String(item.name).trim(),
          priority: ['alta', 'media', 'baja'].includes(item.priority) ? item.priority : 'media',
          why: String(item.why || ''),
          createdAt: item.createdAt || new Date().toISOString().slice(0, 10),
          offers: (Array.isArray(item.offers) ? item.offers : []).map((offer) => ({
            id: offer.id || `woff-${Math.random().toString(36).slice(2, 8)}`,
            store: String(offer.store || ''),
            url: /^https?:\/\//i.test(String(offer.url || '')) ? String(offer.url) : '',
            price: Math.max(0, Number(offer.price) || 0)
          }))
        }));

      if (state.quote.logistics?.deliveryHourRate === 12000) {
        state.quote.logistics.deliveryHourRate = 0;
      }

      state.finance = state.finance || deepClone(window.ERMDefaults.finance);
      state.finance.initialBalance = Number(state.finance.initialBalance || 0) || 0;
      state.finance.ivaCreditBalance = Math.max(0, Number(state.finance.ivaCreditBalance || 0) || 0);
      state.finance.ivaCreditBalanceLocked = Boolean(state.finance.ivaCreditBalanceLocked);
      state.finance.entries = (state.finance.entries || []).map((entry) => ({
        id: entry.id || `fin-${Math.random().toString(36).slice(2, 8)}`,
        date: String(entry.date || ''),
        // Migrate legacy 'Gasto' category to 'Gastos Administrativos'
        category: entry.category === 'Gasto' ? 'Gastos Administrativos' : String(entry.category || 'Varios'),
        orderId: String(entry.orderId || ''),
        orderRef: String(entry.orderRef || ''),
        gastoType: String(entry.gastoType || ''),
        expenseCardId: String(entry.expenseCardId || ''),
        employeeId: String(entry.employeeId || ''),
        employeeRef: String(entry.employeeRef || ''),
        title: String(entry.title || ''),
        detail: String(entry.detail || ''),
        income: Math.max(0, Number(entry.income || 0) || 0),
        expense: Math.max(0, Number(entry.expense || 0) || 0),
        ivaIncluded: entry.category === 'Ajuste de cuadre' ? false : Boolean(entry.ivaIncluded),
        // Solo en "Ajuste de cuadre": saldo real del banco en la fecha del cuadre.
        bankBalance: Number(entry.bankBalance || 0) || 0,
        savingsEndDate: String(entry.savingsEndDate || ''),
        attachments: normalizeAttachments(entry.attachments || []),
        pdfDataUrl: String(entry.pdfDataUrl || ''),
        pdfName: String(entry.pdfName || ''),
        pdfMimeType: String(entry.pdfMimeType || ''),
        pdfSizeKb: Number(entry.pdfSizeKb || 0) || 0,
        createdAt: entry.createdAt || new Date().toISOString()
      })).filter((entry) => entry.date || entry.title);

      // Renombre de estado comercial: 'Pagado (no entregado)' -> 'Abonado (no entregado)'
      const migrateOrderStatus = (value) => (value === 'Pagado (no entregado)' ? 'Abonado (no entregado)' : value);

      if (state.quote && state.quote.status) {
        state.quote.status = migrateOrderStatus(state.quote.status);
      }

      state.orders = (state.orders || []).map((record) => {
        const orderAttachments = normalizeAttachments(record?.attachments || record?.quote?.attachments || []);
        return {
          ...record,
          status: migrateOrderStatus(record?.status),
          attachments: orderAttachments,
          quote: {
            ...(record?.quote || {}),
            status: migrateOrderStatus(record?.quote?.status),
            attachments: normalizeAttachments(record?.quote?.attachments || orderAttachments)
          }
        };
      });

      state.ui.attachmentsUnifiedV1Done = Boolean(state.ui.attachmentsUnifiedV1Done);

      return state;
    } catch (error) {
      console.warn('No se pudo cargar el estado guardado.', error);
      return deepClone(window.ERMDefaults);
    }
  }

  let quotaWarned = false;

  function save(state) {
    try {
      if (backend) backend.write(state);
      else localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      quotaWarned = false;
    } catch (error) {
      console.error('No se pudo guardar el estado en localStorage.', error);
      if (!quotaWarned) {
        quotaWarned = true;
        window.alert('No se pudieron guardar los últimos cambios: el almacenamiento del navegador está lleno. Exporta un respaldo desde la Central de respaldos y elimina adjuntos (PDF/imágenes) pesados.');
      }
    }
  }

  function reset() {
    const fresh = deepClone(window.ERMDefaults);
    if (backend) backend.write(fresh);
    else localStorage.removeItem(STORAGE_KEY);
    return fresh;
  }

  function setBackend(nextBackend) {
    backend = nextBackend;
  }

  return {
    load, save, reset, setBackend, normalizeQuotePriceMode,
    migrateMaterialsToNetBasis, isPendingNetReview, suggestLegacyNet, convertLegacyMaterial, refreshCostBasis
  };
})();
