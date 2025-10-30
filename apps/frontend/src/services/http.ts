import axios from 'axios'
import { getApiBase, onApiBaseChange } from '../lib/apiBase'

export const http = axios.create({ baseURL: getApiBase(), withCredentials: false })

// When the base changes at runtime, update axios instance
onApiBaseChange((base) => { (http.defaults as any).baseURL = base })
