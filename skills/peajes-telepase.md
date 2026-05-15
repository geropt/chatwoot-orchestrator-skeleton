---
id: peajes_telepase
title: Peajes y telepase
description: Facturación al costo de concesión, detalle por pasada, aviso previo por correo, cobro posible después del cierre de la reserva y débito en tarjeta de garantía.
category: administrativo
ask_email: false
---

## Cuándo aplica
- Usuario pregunta si los peajes están incluidos.
- Consulta si puede usar su propio telepase.
- Ve un cobro de peajes y pregunta por qué.
- Consulta por demora del cargo respecto al fin de la reserva.
- Dice que no recibió aviso por correo antes del cobro.
- Duda si el monto coincide con lo que factura la concesión o si hay recargo.
- Pregunta si puede pagar peajes con saldo de cuenta o créditos.

## Preguntas diagnósticas
- ¿Ya te hicieron el cobro o es una consulta previa al viaje?
- ¿Cuál es el código de reserva asociado?
- ¿Recibiste aviso por correo electrónico antes del débito?
- ¿El cargo apareció bastante después de haber cerrado la reserva?
- ¿El monto te resulta razonable para un tramo de peaje que hubieras podido hacer?

## Pasos a guiar
1. Todos los vehículos tienen telepase propio; no hace falta usar el personal.
2. **Facturación:** al cliente se le factura **exactamente** el importe que corresponde a cada pasada según lo informado por la concesión (mismo monto que recibimos en las facturas de cada concesión; sin recargo propio de MyKeego).
3. **Cómo se identifica cada pasada:** la concesión envía el detalle por pasada (día, hora, lugar, importe y patente). Con esa información se **asocia** cada cobro de Telepase del vehículo a la **reserva** correspondiente.
4. **Comunicación y plazos:** antes de efectuar el débito se **notifica al cliente por correo electrónico**. El cobro puede ocurrir **tiempo después** de finalizada la reserva, porque depende de que cada concesión nos brinde ese detalle (patente, día, hora, lugar).
5. **Medio de cobro:** los peajes son **consumo externo** y se **debitan de la tarjeta que el usuario registró en la app como garantía**, no del saldo de cuenta para este concepto.
6. **Saldo a favor y créditos:** los saldos a favor se aplican en el marco de **nuevas reservas** (por ejemplo sobre el **30%** del pago final), **no** para liquidar peajes. Para el detalle de saldos y minutos, usar el skill **saldo_creditos_minutos**.
7. Cada usuario es responsable de los peajes consumidos durante su reserva.
8. Los peajes no estuvieron incluidos como regla general; en algún momento hubo un beneficio temporal, pero no es la norma.

## Cuándo derivar a operador
- Usuario reclama un peaje que dice no haber pasado.
- Reclamo por diferencia en el monto cobrado frente al detalle esperado.
- Usuario no recibió el aviso por correo y reclama antes de aceptar el cobro o pide revisión.
- Disputa sobre la asociación de una pasada (fecha/hora/lugar) con su reserva.

## Restricciones
- No prometer exención de peajes.
- No aplicar devoluciones desde el bot.
- No afirmar fechas exactas en que liquidará cada concesión.
- No indicar que el saldo de cuenta o los créditos cubren el cobro de peajes.
