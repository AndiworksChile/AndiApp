window.ERMCalc = (() => {
  const asNumber = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  };

  const roundMoney = (value) => Math.round((asNumber(value) + Number.EPSILON) * 100) / 100;

  function periodicityFactor(periodicity, months) {
    const safeMonths = Math.max(1, asNumber(months));
    switch (periodicity) {
      case 'mensual': return safeMonths;
      case 'trimestral': return safeMonths / 3;
      case 'anual': return safeMonths / 12;
      case 'unico': return 1;
      default: return safeMonths;
    }
  }

  function totalFixedCosts(scenario) {
    return roundMoney((scenario.fixedCosts || []).reduce((acc, item) => {
      return acc + (asNumber(item.amount) * periodicityFactor(item.periodicity, scenario.periodMonths));
    }, 0));
  }

  // Costo de oportunidad: gasto fijo que no sale del bolsillo (ej. arriendo de un local propio).
  // Suma en el escenario, pero en cada OT se decide cuánto de él cargar.
  function isOpportunityCost(item) {
    return item?.costType === 'oportunidad';
  }

  function opportunityFixedCosts(scenario) {
    return roundMoney((scenario.fixedCosts || []).filter(isOpportunityCost).reduce((acc, item) => {
      return acc + (asNumber(item.amount) * periodicityFactor(item.periodicity, scenario.periodMonths));
    }, 0));
  }

  // Monto mensual máximo de costo de oportunidad (tope del deslizador en el presupuestador).
  function opportunityMonthlyMax(scenario) {
    return roundMoney(opportunityFixedCosts(scenario) / Math.max(1, asNumber(scenario.periodMonths)));
  }

  function projectedPayroll(scenario) {
    return roundMoney((scenario.employees || []).reduce((acc, employee) => {
      return acc + (asNumber(employee.hourlyRate) * asNumber(employee.hoursPerMonth) * Math.max(1, asNumber(scenario.periodMonths)));
    }, 0));
  }

  function totalRawHours(scenario) {
    return roundMoney((scenario.employees || []).reduce((acc, employee) => {
      return acc + (asNumber(employee.hoursPerMonth) * Math.max(1, asNumber(scenario.periodMonths)));
    }, 0));
  }

  function productiveHours(scenario) {
    const raw = totalRawHours(scenario);
    const efficiency = Math.max(0.1, Math.min(1, asNumber(scenario.efficiency) || 0.85));
    return roundMoney(raw * efficiency);
  }

  function averageLaborRate(scenario) {
    const hours = productiveHours(scenario);
    if (!hours) return 0;
    return roundMoney(projectedPayroll(scenario) / hours);
  }

  function cifRate(scenario) {
    const hours = productiveHours(scenario);
    if (!hours) return 0;
    return roundMoney(totalFixedCosts(scenario) / hours);
  }

  function cifRateBreakdown(scenario) {
    const hours = productiveHours(scenario);
    if (!hours) return { cash: 0, opportunity: 0 };
    const opportunity = opportunityFixedCosts(scenario);
    return {
      cash: roundMoney((totalFixedCosts(scenario) - opportunity) / hours),
      opportunity: roundMoney(opportunity / hours)
    };
  }

  // Curva de aprendizaje (Wright): cada vez que se duplica la cantidad, el tiempo promedio
  // por pieza queda en `rate` (1 = sin curva). Devuelve el factor sobre las horas por pieza.
  function learningCurveFactor(quantity, rate) {
    const safeRate = Math.max(0.5, Math.min(1, asNumber(rate) || 1));
    const qty = Math.max(1, asNumber(quantity));
    if (safeRate >= 1 || qty <= 1) return 1;
    return Math.pow(qty, Math.log2(safeRate));
  }

  function targetPrice(cost, targetMargin) {
    const margin = Math.max(0, Math.min(0.95, asNumber(targetMargin)));
    return roundMoney(asNumber(cost) / (1 - margin));
  }

  function projectionSummary(scenario) {
    const fixedCostsTotal = totalFixedCosts(scenario);
    const payrollTotal = projectedPayroll(scenario);
    const availableHours = productiveHours(scenario);
    const projection = scenario.projection || {};

    const periodMonths = Math.max(1, asNumber(scenario.periodMonths) || 1);
    const plannedDirectCosts = roundMoney(asNumber(projection.plannedDirectCosts));
    const averageAdvanceRate = Math.max(0, Math.min(1, asNumber(projection.averageAdvanceRate)));
    const avgHoursPerOrder = Math.max(0.25, asNumber(projection.avgHoursPerOrder) || 6);
    // El usuario ingresa la utilidad objetivo mensual; los costos (fijos + sueldos) ya vienen
    // escalados al período, así que la utilidad también debe escalarse para mantener las unidades.
    const targetMonthlyProfit = roundMoney(asNumber(projection.targetMonthlyProfit));
    const targetPeriodProfit = roundMoney(targetMonthlyProfit * periodMonths);

    const operatingBase = roundMoney(fixedCostsTotal + payrollTotal);
    const plannedTotalCost = roundMoney(operatingBase + plannedDirectCosts);
    const breakEvenSales = roundMoney(plannedTotalCost);
    const minimumSalesRequired = targetPrice(plannedTotalCost, scenario.minimumMargin);
    const idealSalesRequired = targetPrice(plannedTotalCost, scenario.idealMargin);
    const salesForTargetProfit = roundMoney(plannedTotalCost + targetPeriodProfit);
    const recommendedSalesGoal = roundMoney(Math.max(minimumSalesRequired, salesForTargetProfit));
    const minimumProfit = roundMoney(minimumSalesRequired - plannedTotalCost);
    const idealProfit = roundMoney(idealSalesRequired - plannedTotalCost);
    const salesPerHourBreakEven = availableHours ? roundMoney(breakEvenSales / availableHours) : 0;
    const minimumSalesPerHour = availableHours ? roundMoney(minimumSalesRequired / availableHours) : 0;
    const idealSalesPerHour = availableHours ? roundMoney(idealSalesRequired / availableHours) : 0;
    const targetSalesPerHour = availableHours ? roundMoney(salesForTargetProfit / availableHours) : 0;
    const equivalentOrdersCapacity = availableHours ? roundMoney(availableHours / avgHoursPerOrder) : 0;
    const breakEvenAverageSalePerOrder = equivalentOrdersCapacity ? roundMoney(breakEvenSales / equivalentOrdersCapacity) : 0;
    const minimumAverageSalePerOrder = equivalentOrdersCapacity ? roundMoney(minimumSalesRequired / equivalentOrdersCapacity) : 0;
    const idealAverageSalePerOrder = equivalentOrdersCapacity ? roundMoney(idealSalesRequired / equivalentOrdersCapacity) : 0;
    const targetAverageSalePerOrder = equivalentOrdersCapacity ? roundMoney(salesForTargetProfit / equivalentOrdersCapacity) : 0;
    const estimatedAdvanceAtMinimum = roundMoney(minimumSalesRequired * averageAdvanceRate);
    const estimatedAdvanceAtIdeal = roundMoney(idealSalesRequired * averageAdvanceRate);
    const estimatedAdvanceAtTarget = roundMoney(salesForTargetProfit * averageAdvanceRate);
    const capitalNeededAtMinimum = roundMoney(Math.max(0, plannedTotalCost - estimatedAdvanceAtMinimum));
    const capitalNeededAtIdeal = roundMoney(Math.max(0, plannedTotalCost - estimatedAdvanceAtIdeal));
    const capitalNeededAtTarget = roundMoney(Math.max(0, plannedTotalCost - estimatedAdvanceAtTarget));

    return {
      plannedDirectCosts,
      averageAdvanceRate,
      avgHoursPerOrder,
      periodMonths,
      targetMonthlyProfit,
      targetPeriodProfit,
      operatingBase,
      plannedTotalCost,
      breakEvenSales,
      minimumSalesRequired,
      idealSalesRequired,
      salesForTargetProfit,
      recommendedSalesGoal,
      minimumProfit,
      idealProfit,
      salesPerHourBreakEven,
      minimumSalesPerHour,
      idealSalesPerHour,
      targetSalesPerHour,
      equivalentOrdersCapacity,
      breakEvenAverageSalePerOrder,
      minimumAverageSalePerOrder,
      idealAverageSalePerOrder,
      targetAverageSalePerOrder,
      estimatedAdvanceAtMinimum,
      estimatedAdvanceAtIdeal,
      estimatedAdvanceAtTarget,
      capitalNeededAtMinimum,
      capitalNeededAtIdeal,
      capitalNeededAtTarget
    };
  }

  function getMaterial(state, materialId) {
    return (state.database.materials || []).find((item) => item.id === materialId) || null;
  }

  function getEmployee(state, employeeId) {
    return (state.scenario.employees || []).find((item) => item.id === employeeId) || null;
  }

  function getExternalResource(state, resourceId) {
    return (state.database?.externalResources || []).find((item) => item.id === resourceId) || null;
  }

  function logisticsSummary(logistics) {
    const deliveryHours = asNumber(logistics.deliveryHours);
    const deliveryHourRate = asNumber(logistics.deliveryHourRate);
    const laborComponent = roundMoney(deliveryHours * deliveryHourRate);
    const passageCost = logistics.passageCost === '' || logistics.passageCost === null || logistics.passageCost === undefined
      ? 1500
      : asNumber(logistics.passageCost);
    const distanceKm = asNumber(logistics.distanceKm);
    const fuelEfficiencyKmL = Math.max(1, asNumber(logistics.fuelEfficiencyKmL) || 14);
    const fuelPricePerLiter = asNumber(logistics.fuelPricePerLiter) || 1300;
    const estimatedLiters = roundMoney(distanceKm / fuelEfficiencyKmL);
    const fuelCost = roundMoney(estimatedLiters * fuelPricePerLiter);
    const tollCost = asNumber(logistics.tollCost);
    const parkingCost = asNumber(logistics.parkingCost);
    const packingCost = asNumber(logistics.packingCost);
    const carrierCost = asNumber(logistics.externalCarrierCost);
    const extraCost = asNumber(logistics.extraCost);

    switch (logistics.mode) {
      case 'metro':
        return {
          mode: 'metro',
          passageCost,
          extraCost,
          total: roundMoney(passageCost + extraCost),
          formula: 'Pasajes + extra'
        };
      case 'domicilio':
        return {
          mode: 'domicilio',
          distanceKm,
          fuelEfficiencyKmL,
          fuelPricePerLiter,
          estimatedLiters,
          fuelCost,
          tollCost,
          parkingCost,
          laborComponent,
          extraCost,
          total: roundMoney(fuelCost + tollCost + parkingCost + laborComponent + extraCost),
          formula: 'Bencina + peajes + estacionamiento + tiempo + extra'
        };
      case 'starken':
        return {
          mode: 'starken',
          packingCost,
          carrierCost,
          extraCost,
          total: roundMoney(packingCost + carrierCost + extraCost),
          formula: 'Embalaje + transportista + extra'
        };
      case 'retiro':
      default:
        return {
          mode: 'retiro',
          total: 0,
          formula: 'Sin costo logístico'
        };
    }
  }

  function priceTargetStatus(price, minimumNet, idealNet) {
    const current = roundMoney(price);
    if (current < roundMoney(minimumNet)) {
      return {
        key: 'below',
        text: 'Bajo las metas definidas',
        description: 'La utilidad queda por debajo del mínimo esperado y demasiado cerca del costo real.',
        tone: 'warn'
      };
    }
    if (current > roundMoney(idealNet)) {
      return {
        key: 'above',
        text: 'Sobre las metas definidas',
        description: 'Supera el rango ideal del escenario y destaca como un producto especialmente valioso.',
        tone: 'ok'
      };
    }
    return {
      key: 'within',
      text: 'Dentro de las metas definidas',
      description: 'Se mantiene dentro del rango proyectado por el escenario.',
      tone: 'info'
    };
  }

  function averageOrderSignal(price, projection) {
    const current = roundMoney(price);
    if (current >= asNumber(projection.idealAverageSalePerOrder)) {
      return { level: 'ideal', text: 'Cumple el valor promedio ideal por orden', value: asNumber(projection.idealAverageSalePerOrder) };
    }
    if (current >= asNumber(projection.targetAverageSalePerOrder)) {
      return { level: 'target', text: 'Cumple el valor promedio de utilidad objetivo por orden', value: asNumber(projection.targetAverageSalePerOrder) };
    }
    if (current >= asNumber(projection.minimumAverageSalePerOrder)) {
      return { level: 'minimum', text: 'Cumple el valor promedio mínimo por orden', value: asNumber(projection.minimumAverageSalePerOrder) };
    }
    if (current >= asNumber(projection.breakEvenAverageSalePerOrder)) {
      return { level: 'breakEven', text: 'Cubre el valor promedio de equilibrio por orden', value: asNumber(projection.breakEvenAverageSalePerOrder) };
    }
    return { level: 'low', text: 'Queda bajo el valor promedio proyectado por orden', value: asNumber(projection.breakEvenAverageSalePerOrder) };
  }

  function calculateQuote(state) {
    const scenario = state.scenario;
    const quote = state.quote;

    const fixedCostsTotal = totalFixedCosts(scenario);
    const payrollTotal = projectedPayroll(scenario);
    const availableHours = productiveHours(scenario);
    const cifPerHour = cifRate(scenario);
    const laborReferenceRate = averageLaborRate(scenario);
    const projection = projectionSummary(scenario);

    // Cantidad de piezas iguales. Cada línea es "por pieza" (se multiplica) o "por pedido"
    // (preparación, diseño, set-up: se cobra una sola vez). La logística nunca se multiplica.
    const parsedPieceQuantity = Math.round(asNumber(quote.pieceQuantity));
    const pieceQuantity = Number.isFinite(parsedPieceQuantity) && parsedPieceQuantity >= 1 ? parsedPieceQuantity : 1;
    const learningRate = Math.max(0.5, Math.min(1, asNumber(quote.learningRate) || 1));
    const learningFactor = learningCurveFactor(pieceQuantity, learningRate);
    const isPerOrder = (line) => line.scope === 'order';

    const materialLines = (quote.materials || []).map((line) => {
      const material = getMaterial(state, line.materialId);
      const quantity = asNumber(line.quantity);
      const unitCost = asNumber(material?.unitCost);
      const wastePercent = Math.max(0, asNumber(line.wastePercent)) / 100;
      const baseLineTotal = roundMoney(quantity * unitCost);
      const wasteAmount = roundMoney(baseLineTotal * wastePercent);
      const effectiveQuantity = asNumber((quantity * (1 + wastePercent)).toFixed(4));
      const lineTotal = roundMoney(baseLineTotal + wasteAmount);
      const scope = isPerOrder(line) ? 'order' : 'unit';
      return {
        ...line,
        scope,
        material,
        quantity,
        unitCost,
        wastePercent,
        effectiveQuantity,
        baseLineTotal,
        wasteAmount,
        lineTotal,
        orderTotal: roundMoney(scope === 'order' ? lineTotal : lineTotal * pieceQuantity)
      };
    });

    const safeEfficiency = Math.max(0.1, Math.min(1, asNumber(scenario.efficiency) || 0.85));

    const laborLines = (quote.labor || []).map((line) => {
      const employee = getEmployee(state, line.employeeId);
      const externalResource = getExternalResource(state, line.employeeId);
      // Solo se asume 1 h cuando el campo viene vacío; un 0 explícito debe costar 0.
      const hasExplicitHours = line.hours !== '' && line.hours !== null && line.hours !== undefined;
      const hours = Math.max(0, hasExplicitHours ? asNumber(line.hours) : 1);
      const hasExplicitRate = line.rate !== '' && line.rate !== null && line.rate !== undefined;
      const baseRate = asNumber(employee?.hourlyRate) || asNumber(externalResource?.hourlyRate) || laborReferenceRate;
      const nominalRate = hasExplicitRate ? asNumber(line.rate) : baseRate;
      const appliesEfficiency = !externalResource;
      const realRate = roundMoney(appliesEfficiency ? (nominalRate / safeEfficiency) : nominalRate);
      const scope = isPerOrder(line) ? 'order' : 'unit';
      const orderHours = asNumber((scope === 'order' ? hours : hours * pieceQuantity * learningFactor).toFixed(4));
      return {
        ...line,
        scope,
        employee,
        externalResource,
        hours,
        orderHours,
        rate: nominalRate,
        realRate,
        efficiencyApplied: appliesEfficiency ? safeEfficiency : 1,
        lineTotal: roundMoney(hours * realRate),
        orderTotal: roundMoney(orderHours * realRate)
      };
    });

    // CIF: solo las horas propias usan el taller; las horas de recursos externos no cargan CIF.
    // El costo de oportunidad (arriendo) se carga en la fracción que se elija en la OT.
    const cifBreakdown = cifRateBreakdown(scenario);
    const rentMonthlyMax = opportunityMonthlyMax(scenario);
    const hasRentApplied = quote.rentApplied !== '' && quote.rentApplied !== null && quote.rentApplied !== undefined;
    const rentApplied = rentMonthlyMax > 0
      ? Math.max(0, Math.min(rentMonthlyMax, hasRentApplied ? asNumber(quote.rentApplied) : rentMonthlyMax))
      : 0;
    const rentFraction = rentMonthlyMax > 0 ? rentApplied / rentMonthlyMax : 0;
    const cifRentPerHour = roundMoney(cifBreakdown.opportunity * rentFraction);
    const cifPerHourApplied = roundMoney(cifBreakdown.cash + cifRentPerHour);

    const materialsTotal = roundMoney(materialLines.reduce((acc, line) => acc + line.orderTotal, 0));
    const laborTotal = roundMoney(laborLines.reduce((acc, line) => acc + line.orderTotal, 0));
    const totalLaborHours = roundMoney(laborLines.reduce((acc, line) => acc + line.orderHours, 0));
    const cifHours = roundMoney(laborLines.filter((line) => !line.externalResource).reduce((acc, line) => acc + line.orderHours, 0));
    const cifCashTotal = roundMoney(cifHours * cifBreakdown.cash);
    const cifRentTotal = roundMoney(cifHours * cifRentPerHour);
    const cifTotal = roundMoney(cifCashTotal + cifRentTotal);
    const productionCost = roundMoney(materialsTotal + laborTotal + cifTotal);
    const internalCost = productionCost;
    const unitCost = roundMoney(productionCost / pieceQuantity);
    const logisticsBreakdown = logisticsSummary(quote.logistics || {});
    const logisticsTotal = logisticsBreakdown.total;
    const totalCost = roundMoney(productionCost + logisticsTotal);
    // Piso real: lo que cuesta la OT sin cargar nada de costo de oportunidad.
    const cashFloorNet = roundMoney(totalCost - cifRentTotal);

    const breakEvenNet = roundMoney(totalCost);
    const minimumNet = targetPrice(totalCost, scenario.minimumMargin);
    const idealNet = targetPrice(totalCost, scenario.idealMargin);
    const ivaMultiplier = 1 + Math.max(0, asNumber(scenario.ivaRate));
    const customGross = roundMoney(asNumber(quote.customPriceGross));
    const customNet = roundMoney(customGross > 0 ? (customGross / ivaMultiplier) : 0);
    const customIvaAmount = roundMoney(Math.max(0, customGross - customNet));
    const selectedPriceMode = ['breakEven', 'minimum', 'ideal', 'custom'].includes(quote.selectedPriceMode)
      ? quote.selectedPriceMode
      : (customGross > 0 ? 'custom' : 'minimum');
    const suggestedNetByMode = {
      breakEven: breakEvenNet,
      minimum: minimumNet,
      ideal: idealNet
    };
    const effectiveNet = roundMoney(selectedPriceMode === 'custom'
      ? (customNet > 0 ? customNet : minimumNet)
      : (suggestedNetByMode[selectedPriceMode] || minimumNet));
    const effectiveGross = roundMoney(selectedPriceMode === 'custom'
      ? (customGross > 0 ? customGross : (minimumNet * ivaMultiplier))
      : (effectiveNet * ivaMultiplier));
    const contribution = roundMoney(effectiveNet - totalCost);
    const realMargin = effectiveNet > 0 ? contribution / effectiveNet : 0;

    const selectedStatus = priceTargetStatus(effectiveNet, minimumNet, idealNet);
    const averageSaleSignal = averageOrderSignal(effectiveNet, projection);

    let marginStatus = 'bajo';
    if (realMargin >= asNumber(scenario.idealMargin)) {
      marginStatus = 'ideal';
    } else if (realMargin >= asNumber(scenario.minimumMargin)) {
      marginStatus = 'minimo';
    }

    return {
      scenarioSummary: {
        fixedCostsTotal,
        payrollTotal,
        availableHours,
        cifPerHour,
        laborReferenceRate,
        projection
      },
      quoteSummary: {
        materialLines,
        laborLines,
        materialsTotal,
        laborTotal,
        totalLaborHours,
        cifHours,
        cifPerHourApplied,
        cifCashPerHour: cifBreakdown.cash,
        cifRentPerHour,
        cifCashTotal,
        cifRentTotal,
        cifTotal,
        rentApplied,
        rentMonthlyMax,
        learningRate,
        learningFactor,
        cashFloorNet,
        internalCost,
        pieceQuantity,
        unitCost,
        productionCost,
        logisticsBreakdown,
        logisticsTotal,
        totalCost,
        breakEvenNet,
        minimumNet,
        idealNet,
        selectedPriceMode,
        customNet,
        customGross,
        customIvaAmount,
        effectiveNet,
        minimumGross: roundMoney(minimumNet * ivaMultiplier),
        idealGross: roundMoney(idealNet * ivaMultiplier),
        effectiveGross,
        contribution,
        realMargin,
        marginStatus,
        selectedStatus,
        averageSaleSignal
      }
    };
  }

  return {
    asNumber,
    roundMoney,
    periodicityFactor,
    totalFixedCosts,
    projectedPayroll,
    productiveHours,
    averageLaborRate,
    cifRate,
    cifRateBreakdown,
    opportunityFixedCosts,
    opportunityMonthlyMax,
    learningCurveFactor,
    targetPrice,
    projectionSummary,
    calculateQuote
  };
})();
