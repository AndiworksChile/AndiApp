window.ERMStorage = (() => {
  const STORAGE_KEY = 'erm-proyecta-state-v1';

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

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
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
        ui: { ...deepClone(window.ERMDefaults.ui), ...(parsed.ui || {}) }
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

      if (state.ui.databaseFilter === 'Material') {
        state.ui.databaseFilter = 'Placas';
      }

      if (!state.quote.selectedPriceMode) {
        state.quote.selectedPriceMode = 'target';
      }

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

      state.database.externalResources = (state.database.externalResources || []).map((item) => ({
        id: item.id || `ext-${Math.random().toString(36).slice(2, 8)}`,
        type: item.type || 'ayuda',
        name: String(item.name || '').trim(),
        hourlyRate: Number(item.hourlyRate || 0) || 0,
        description: item.description || '',
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
        offers: Array.isArray(item.offers) ? item.offers.map((offer) => ({
          id: offer.id || `off-${Math.random().toString(36).slice(2, 8)}`,
          price: Number(offer.price || 0) || 0,
          link: offer.link || '',
          entryDate: offer.entryDate || new Date().toISOString().slice(0, 10)
        })) : []
        };
      }).filter((item) => item.name);

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
        ivaIncluded: Boolean(entry.ivaIncluded),
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

  function save(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function reset() {
    localStorage.removeItem(STORAGE_KEY);
    return deepClone(window.ERMDefaults);
  }

  return { load, save, reset };
})();
