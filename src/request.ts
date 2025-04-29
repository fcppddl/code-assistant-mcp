import axios from "axios";
import { config } from "dotenv";

config();

const TOKEN =
  process.argv
    .find((arg) => arg.startsWith("--mify-api-key="))
    ?.split("=")[1] || (process.env.MIFY_API_KEY as string);

const instance = axios.create({
  baseURL: "https://mify-be.pt.xiaomi.com/api/v1",
  timeout: 100000,
});

instance.defaults.headers.common["Authorization"] = `Bearer ${TOKEN}`;

export default instance;
