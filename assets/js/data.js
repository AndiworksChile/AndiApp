window.ERMDefaults = (() => {
  const uid = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
  const andresId = uid('emp');
  const currentYear = String(new Date().getFullYear());

  const expenseEntriesByPeriod = {
    mensual: 12,
    trimestral: 4,
    semestral: 2,
    anual: 1
  };

  const defaultExpenseEntries = (period = 'mensual') => {
    const count = expenseEntriesByPeriod[period] || 12;
    return Array.from({ length: count }, (_, index) => ({
      id: uid('exp-entry'),
      label: `Cuota ${index + 1}`,
      amount: 0,
      date: '',
      status: 'no-pagado',
      notes: '',
      attachments: [],
      pdfDataUrl: '',
      pdfName: '',
      pdfMimeType: '',
      pdfSizeKb: 0
    }));
  };

  const defaultExpenseCards = () => ([
    {
      id: uid('exp-card'),
      name: 'Agua',
      color: '#1f8d8a',
      description: 'Registro anual de consumo y pago de agua.',
      baseYear: currentYear,
      period: 'mensual',
      entries: defaultExpenseEntries('mensual')
    },
    {
      id: uid('exp-card'),
      name: 'Luz',
      color: '#f39b24',
      description: 'Registro anual de cuentas eléctricas.',
      baseYear: currentYear,
      period: 'mensual',
      entries: defaultExpenseEntries('mensual')
    },
    {
      id: uid('exp-card'),
      name: 'F29',
      color: '#4c78d7',
      description: 'Registro de impuestos y pagos de F29.',
      baseYear: currentYear,
      period: 'mensual',
      entries: defaultExpenseEntries('mensual')
    }
  ]);

  return {
    appName: 'AndiApp',
    currentView: 'scenario',
    ui: {
      editingMaterialId: null,
      editingProductTypeId: null,
      editingExternalResourceId: null,
      editingContactId: null,
      selectedOrderId: null,
      editingOrderId: null,
      orderFilter: 'Todas',
      orderSortByNumber: false,
      scenarioLocked: false,
      lastScenarioSavedAt: null,
      baseScenarioUpdatedAt: null,
      baseDatabaseUpdatedAt: null,
      baseProductTypesUpdatedAt: null,
      baseExternalUpdatedAt: null,
      baseContactsUpdatedAt: null,
      baseOrdersUpdatedAt: null,
      baseExpensesUpdatedAt: null,
      baseDesiredUpdatedAt: null,
      baseAttendanceUpdatedAt: null,
      baseFinanceUpdatedAt: null,
      editingFinanceId: null,
      financeDraft: null,
      financeQuickOutflowTypes: [],
      financeMonthFilter: '',
      financeCategoryFilter: 'Todas',
      inventorySection: 'company',
      databaseSection: 'materials',
      databaseFilter: 'Todos',
      databaseSort: 'date-desc',
      databaseDraft: null,
      productTypeDraft: null,
      externalResourceDraft: null,
      editingDesiredId: null,
      desiredDraft: null,
      contactDraft: null,
      selectedExpenseId: null,
      expenseDraft: null,
      attendanceEditingId: null,
      inlinePdfViewer: null,
      theme: 'light',
      generalNotes: '',
      generalNotesHtml: '',
      cleanInstall: false,
      notesWindow: {
        x: null,
        y: null,
        width: 210,
        height: 165
      },
      attachmentsUnifiedV1Done: false
    },
    scenario: {
      periodMonths: 1,
      efficiency: 0.7,
      ivaRate: 0.19,
      minimumMargin: 0.35,
      idealMargin: 0.55,
      fixedCosts: [
        { id: uid('fc'), name: 'Arriendo taller', periodicity: 'mensual', amount: 300000 },
        { id: uid('fc'), name: 'Internet', periodicity: 'mensual', amount: 17990 },
        { id: uid('fc'), name: 'Electricidad', periodicity: 'mensual', amount: 40000 },
        { id: uid('fc'), name: 'Agua', periodicity: 'mensual', amount: 30000 },
        { id: uid('fc'), name: 'IA Copilot', periodicity: 'mensual', amount: 8990 },
        { id: uid('fc'), name: 'Dominio Web', periodicity: 'anual', amount: 9990 },
        { id: uid('fc'), name: 'Deterioro y mantención de herramientas', periodicity: 'anual', amount: 300000 },
        { id: uid('fc'), name: 'Consumibles no trazados', periodicity: 'mensual', amount: 20000 },
        { id: uid('fc'), name: 'Limpieza y orden', periodicity: 'mensual', amount: 15000 }
      ],
      employees: [
        { id: andresId, name: 'Andrés', hourlyRate: 5000, hoursPerMonth: 160 }
      ],
      projection: {
        plannedDirectCosts: 300000,
        averageAdvanceRate: 0.5,
        avgHoursPerOrder: 6,
        targetMonthlyProfit: 500000
      },
      personalGoals: []
    },
    quote: {
      orderTitle: 'Orden de trabajo base',
      customerId: '',
      customerName: 'Cliente Demo',
      productName: 'Letrero Acrílico',
      isPrototype: false,
      quoteDate: new Date().toISOString().slice(0, 10),
      estimatedDeliveryDate: '',
      orderNumber: 'OT-001',
      status: 'Prospecto',
      deliveryState: 'Abierta',
      attachments: [],
      invoicePdfDataUrl: '',
      invoicePdfName: '',
      invoicePdfMimeType: '',
      invoicePdfSizeKb: 0,
      description: 'Ejemplo base para validar el flujo interno de cotización.',
      selectedPriceMode: 'target',
      selectedPriceNet: 0,
      customPriceGross: 0,
      pieceQuantity: 1,
      materials: [],
      labor: [
        { id: uid('qll'), employeeId: andresId, assignmentType: 'hora', hours: 1, rate: 5000, directLabel: '', directCost: 0 }
      ],
      logistics: {
        mode: 'retiro',
        metroStation: '',
        passageCost: 1500,
        deliveryHours: 0,
        deliveryHourRate: 0,
        distanceKm: 0,
        fuelEfficiencyKmL: 14,
        fuelPricePerLiter: 1300,
        tollCost: 0,
        parkingCost: 0,
        packingCost: 0,
        externalCarrierCost: 0,
        extraCost: 0,
        recipientName: '',
        recipientRut: '',
        recipientEmail: '',
        recipientPhone: '',
        address: '',
        district: '',
        notes: ''
      }
    },
    database: {
      materials: [],
      productTypes: [],
      externalResources: []
    },
    inventory: {
      desiredItems: []
    },
    expenses: {
      cards: defaultExpenseCards()
    },
    attendance: {
      activeSession: null,
      records: []
    },
    finance: {
      initialBalance: 0,
      // Crédito fiscal de IVA que la empresa ya tenía acumulado ANTES de empezar a registrar
      // movimientos en esta app (ej.: compras/construcción previas). Como la app no está
      // conectada al SII, este valor se ingresa una sola vez a mano y se arrastra mes a mes.
      ivaCreditBalance: 0,
      ivaCreditBalanceLocked: false,
      entries: []
    },
    contacts: [],
    orders: []
  };
})();
