const cron = require('node-cron');
const supabaseService = require('./supabaseService');
const config = require('../config/config');

// Función para resetear las solicitudes de usuarios FREE a 20 cada mes y notificarles
async function resetFreeUserRequests(bot) {
  try {
    console.log('🔄 Iniciando reseteo mensual de solicitudes para usuarios FREE...');
    
    // Obtener todos los usuarios con suscripción FREE
    const { data, error } = await supabaseService.supabase
      .from('patients')
      .select('user_id, subscription, requests')
      .eq('subscription', 'FREE');
    
    if (error) {
      console.error('Error al obtener usuarios FREE:', error);
      return;
    }
    
    console.log(`📊 Encontrados ${data.length} usuarios FREE para resetear solicitudes`);
    
    // Actualizar las solicitudes de cada usuario FREE a 20 y enviar notificación
    let successCount = 0;
    let errorCount = 0;
    let notificationCount = 0;
    
    for (const user of data) {
      try {
        // Actualizar solicitudes
        const { error: updateError } = await supabaseService.supabase
          .from('patients')
          .update({ requests: '20' })
          .eq('user_id', user.user_id);
        
        if (updateError) {
          console.error(`Error al resetear solicitudes para usuario ${user.user_id}:`, updateError);
          errorCount++;
          continue;
        }
        
        successCount++;
        
        // Enviar notificación al usuario
        try {
          await bot.sendMessage(
            user.user_id,
            "🎉 ¡Buenas noticias! 🎉\n\n" +
            "Tus solicitudes mensuales han sido renovadas. Ahora tienes 20 nuevas solicitudes disponibles para este mes.\n\n" +
            "Recuerda que puedes actualizar a Premium para disfrutar de solicitudes ilimitadas y más funciones.\n" +
            "Usa /premium para más información.\n\n" +
            "¡Buen provecho! 🍽️✨"
          );
          notificationCount++;
        } catch (notificationError) {
          console.error(`Error al enviar notificación al usuario ${user.user_id}:`, notificationError);
          // No incrementamos errorCount aquí porque la actualización de solicitudes fue exitosa
        }
      } catch (userError) {
        console.error(`Error al procesar usuario ${user.user_id}:`, userError);
        errorCount++;
      }
    }
    
    console.log(`✅ Reseteo mensual completado: ${successCount} usuarios actualizados, ${notificationCount} notificaciones enviadas, ${errorCount} errores`);
  } catch (error) {
    console.error('Error en reseteo mensual de solicitudes:', error);
  }
}

// Iniciar las tareas programadas
function initScheduledTasks(bot) {
  // Verificar que el bot esté disponible
  if (!bot) {
    console.error('Error: Se requiere una instancia del bot para iniciar las tareas programadas');
    return;
  }
  
  // Programar reseteo de solicitudes para el primer día de cada mes a las 00:01
  // Formato cron: segundo minuto hora día-del-mes mes día-de-la-semana
  cron.schedule('1 0 0 1 * *', () => resetFreeUserRequests(bot), {
    timezone: 'America/Argentina/Buenos_Aires' // Ajustar a la zona horaria de Argentina
  });
  
  console.log('🕒 Tareas programadas iniciadas: Reseteo mensual de solicitudes configurado');
  
  // Ejecutar inmediatamente para pruebas (comentar en producción)
  // resetFreeUserRequests(bot);
}

module.exports = {
  initScheduledTasks,
  resetFreeUserRequests // Exportamos la función para poder llamarla manualmente si es necesario
}; 