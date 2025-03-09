// Handler for /profesional command
async function handleProfesionalCommand(ctx) {
  try {
    const message = "🏥 Por favor, ingresa el ID de tu médico profesional:";

    // Save in context that we're waiting for professional ID
    ctx.session.awaitingProfessionalId = true;

    await ctx.reply(message);
  } catch (error) {
    console.error("Error in handleProfesionalCommand:", error);
    await ctx.reply(
      "❌ Ocurrió un error al procesar tu solicitud. Por favor, intenta nuevamente."
    );
  }
}

module.exports = {
  handleProfesionalCommand,
};
