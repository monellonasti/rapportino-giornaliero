import "dotenv/config";
import { readConfig } from "../app/config.server";
readConfig(process.env);
console.log(
  "Variabili valide; valori segreti non stampati. Connessione DB/Shopify/SMTP da verificare separatamente.",
);
