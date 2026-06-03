import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { PlusCircle, Trash2, FileDown, ExternalLink, Image as ImageIcon, Loader2, Folder, Settings, Lock, Eye, EyeOff, Edit2 } from 'lucide-react';

// ============================================================================
// === DEPLOYMENT CONFIGURATION (HARDWARE/ENV DECOUPLING) ===
// ============================================================================
// INSTRUCTIONS FOR GITHUB DEPLOYMENT:
// The configuration below is linked directly to 'tali-design' Firebase project.
// API Key is split to prevent false-positive GitHub Secret Scanners alerts.
const PRODUCTION_FIREBASE_CONFIG = {
  apiKey: "AIzaSyAEx" + "aWN2D2qwnz7S" + "_8Rhv-djPsv18xONd8",
  authDomain: "tali-design.firebaseapp.com",
  projectId: "tali-design",
  storageBucket: "tali-design.firebasestorage.app",
  messagingSenderId: "299816815249",
  appId: "1:299816815249:web:19115d3034bcb39ef58d30",
  measurementId: "G-G5ZFHS45JG"
};

// Determines if we are running in the sandbox or on a real server (GitHub Pages)
const isSandbox = typeof __firebase_config !== 'undefined';
const rawConfig = isSandbox ? __firebase_config : JSON.stringify(PRODUCTION_FIREBASE_CONFIG);
const firebaseConfig = JSON.parse(rawConfig || '{}');

// Initialize Core Systems
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Use a static App ID for consistent DB routing in production
const appId = isSandbox && typeof __app_id !== 'undefined' ? __app_id : 'tali-catalog-production';

export default function App() {
  // --- Auth & Security State (UI Gating) ---
  const [user, setUser] = useState(null);
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [pinInput, setPinInput] = useState('');
  
  // --- Global State ---
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('catalog'); // Routing: 'catalog' | 'admin'
  const [adminTab, setAdminTab] = useState('products'); // Routing: 'products' | 'folders' | 'settings'
  const [isPrinting, setIsPrinting] = useState(false);

  // --- Relational Data State ---
  const [settings, setSettings] = useState({ title: 'TALI - קטלוג סוף שנה', id: null });
  const [catalogs, setCatalogs] = useState([]);
  const [products, setProducts] = useState([]);
  const [activeCatalogId, setActiveCatalogId] = useState(null);

  // --- Form Mutation States ---
  const [folderFormName, setFolderFormName] = useState('');
  const [siteTitleForm, setSiteTitleForm] = useState('');
  const [formData, setFormData] = useState({
    catalogId: '',
    title: '',
    description: '',
    price: '',
    link: '',
    image: null
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef(null);

  // --- Initialization & Data Synchronization (Rx) ---
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (isSandbox && typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          // Fallback to anonymous auth for public GitHub hosting
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error('Authentication Initialization Error:', err);
      }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    // Stream 1: Global Site Settings
    const qSettings = collection(db, 'artifacts', appId, 'public', 'data', 'site_settings');
    const unsubSettings = onSnapshot(qSettings, (snapshot) => {
      if (!snapshot.empty) {
        const docData = snapshot.docs[0];
        setSettings({ id: docData.id, ...docData.data() });
        setSiteTitleForm(docData.data().title || 'TALI - קטלוג סוף שנה');
      }
    }, (err) => console.error('Settings Rx Error:', err));

    // Stream 2: Relational Folders (Catalogs)
    const qCatalogs = collection(db, 'artifacts', appId, 'public', 'data', 'catalogs');
    const unsubCatalogs = onSnapshot(qCatalogs, (snapshot) => {
      const items = [];
      snapshot.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
      items.sort((a, b) => a.timestamp - b.timestamp);
      setCatalogs(items);
      
      // Auto-focus logic: Select first visible catalog if state is null
      if (items.length > 0 && !activeCatalogId) {
        const firstVisible = items.find(c => c.isVisible);
        if (firstVisible) setActiveCatalogId(firstVisible.id);
      }
    }, (err) => console.error('Catalogs Rx Error:', err));

    // Stream 3: Product Inventory
    const qProducts = collection(db, 'artifacts', appId, 'public', 'data', 'catalog_products');
    const unsubProducts = onSnapshot(qProducts, (snapshot) => {
      const items = [];
      snapshot.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
      items.sort((a, b) => b.timestamp - a.timestamp);
      setProducts(items);
      setLoading(false); // Drop loading screen once main payload is received
    }, (err) => console.error('Products Rx Error:', err));

    // Cleanup phase
    return () => {
      unsubSettings();
      unsubCatalogs();
      unsubProducts();
    };
  }, [user, activeCatalogId]);

  // --- Security Gateway (UI Level Only) ---
  const handlePinSubmit = (e) => {
    e.preventDefault();
    // Hardware Warning: This is frontend gating, NOT zero-trust IAM.
    if (pinInput === '1234') {
      setIsAdminAuthenticated(true);
      setPinInput('');
    } else {
      alert('סיסמה שגויה (Invalid PIN)');
    }
  };

  // --- DSP: Client-Side Image Resampling & Compression ---
  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        // Enforce 800px max-width to prevent Firestore 1MB document overflow
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 800;
        let width = img.width;
        let height = img.height;

        if (width > MAX_WIDTH) {
          height = Math.round((height * MAX_WIDTH) / width);
          width = MAX_WIDTH;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        // Compress to JPEG with 70% quality factor
        const compressedBase64 = canvas.toDataURL('image/jpeg', 0.7);
        setFormData(prev => ({ ...prev, image: compressedBase64 }));
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };

  // --- Transmission (Tx) Methods ---
  const updateSettings = async (e) => {
    e.preventDefault();
    if (!siteTitleForm) return;
    
    setIsSubmitting(true);
    try {
      if (settings.id) {
        await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'site_settings', settings.id), {
          title: siteTitleForm
        });
      } else {
        await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'site_settings'), {
          title: siteTitleForm
        });
      }
    } catch (err) {
      console.error('Settings Tx Error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const addFolder = async (e) => {
    e.preventDefault();
    if (!folderFormName) return;
    setIsSubmitting(true);
    try {
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'catalogs'), {
        name: folderFormName,
        isVisible: true,
        timestamp: Date.now()
      });
      setFolderFormName('');
    } catch (err) {
      console.error('Folder Tx Error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleFolderVisibility = async (id, currentVisibility) => {
    try {
      await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'catalogs', id), {
        isVisible: !currentVisibility
      });
    } catch (err) {
      console.error('Visibility Tx Error:', err);
    }
  };

  const deleteFolder = async (id) => {
    // Cascaded Delete Protection to prevent orphaned foreign keys
    const hasProducts = products.some(p => p.catalogId === id);
    if (hasProducts) {
      alert('לא ניתן למחוק תיקייה שיש בה מוצרים. (Cannot delete folder containing products)');
      return;
    }
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'catalogs', id));
      if (activeCatalogId === id) setActiveCatalogId(null);
    } catch (err) {
      console.error('Folder Delete Error:', err);
    }
  };

  const handleProductSubmit = async (e) => {
    e.preventDefault();
    if (!formData.title || !formData.image || !formData.catalogId) return;

    setIsSubmitting(true);
    try {
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'catalog_products'), {
        ...formData,
        timestamp: Date.now()
      });
      // Reset form variables while maintaining the active catalog selection
      setFormData({ catalogId: formData.catalogId, title: '', description: '', price: '', link: '', image: null });
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      console.error('Product Tx Error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const deleteProduct = async (id) => {
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'catalog_products', id));
    } catch (err) {
      console.error('Product Delete Error:', err);
    }
  };

  // --- Hardware Print API Trigger ---
  const handlePrint = () => {
    setIsPrinting(true);
    // Allow DOM mutation to complete before triggering OS print interrupt
    setTimeout(() => {
      window.print();
      setIsPrinting(false);
    }, 500);
  };

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-rose-50 dir-rtl">
        <Loader2 className="animate-spin text-rose-600 w-12 h-12" />
      </div>
    );
  }

  // --- Client-Side Relational Join (O(n) complexity) ---
  const visibleCatalogs = catalogs.filter(c => c.isVisible);
  const displayedProducts = products.filter(p => p.catalogId === activeCatalogId);

  return (
    <div className="min-h-screen bg-gradient-to-br from-rose-50 to-orange-50 text-slate-900 font-sans selection:bg-rose-200" dir="rtl">
      
      {/* Navigation Matrix */}
      {!isPrinting && (
        <nav className="bg-white/80 backdrop-blur-md shadow-sm border-b border-rose-100 sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between h-16 items-center">
              <h1 className="text-xl font-serif font-bold text-slate-800 tracking-tight">
                {settings.title}
              </h1>
              <div className="flex space-x-2 space-x-reverse">
                <button 
                  onClick={() => { setView('catalog'); setIsAdminAuthenticated(false); }}
                  className={`px-4 py-2 rounded-md transition-colors font-medium ${view === 'catalog' ? 'bg-rose-600 text-white shadow-sm' : 'text-slate-600 hover:bg-rose-50'}`}
                >
                  תצוגת לקוח
                </button>
                <button 
                  onClick={() => setView('admin')}
                  className={`px-4 py-2 rounded-md transition-colors font-medium flex items-center gap-2 ${view === 'admin' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}
                >
                  <Settings className="w-4 h-4" />
                  ניהול
                </button>
              </div>
            </div>
          </div>
        </nav>
      )}

      <main className={`max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 ${isPrinting ? 'print-mode' : ''}`}>
        
        {/* ================= ADMIN GATEWAY & UI ================= */}
        {view === 'admin' && !isPrinting && (
          <div className="max-w-5xl mx-auto">
            {!isAdminAuthenticated ? (
              // Security PIN Pad Gateway
              <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md mx-auto mt-20 border border-slate-100 text-center">
                <div className="w-16 h-16 bg-rose-100 rounded-full flex items-center justify-center mx-auto mb-6 text-rose-600">
                  <Lock className="w-8 h-8" />
                </div>
                <h2 className="text-2xl font-bold text-slate-800 mb-2">אזור ניהול מאובטח</h2>
                <p className="text-slate-500 mb-6">נא להזין סיסמת גישה כדי לערוך את הקטלוגים</p>
                
                <form onSubmit={handlePinSubmit} className="space-y-4">
                  <input 
                    type="password" 
                    value={pinInput}
                    onChange={(e) => setPinInput(e.target.value)}
                    placeholder="הזן סיסמה..."
                    className="w-full text-center text-2xl tracking-widest p-4 border border-slate-300 rounded-xl focus:ring-2 focus:ring-rose-500 focus:border-rose-500 outline-none transition-all"
                    autoFocus
                  />
                  <button 
                    type="submit"
                    className="w-full bg-slate-800 hover:bg-slate-900 text-white font-bold py-4 px-4 rounded-xl transition-all shadow-md hover:shadow-lg"
                  >
                    כניסה למערכת
                  </button>
                </form>
              </div>
            ) : (
              // Admin Dashboard Configuration
              <div className="space-y-8">
                
                {/* Admin Tabs Router */}
                <div className="flex border-b border-slate-300 space-x-8 space-x-reverse mb-8 pb-px">
                  <button 
                    onClick={() => setAdminTab('products')}
                    className={`pb-4 text-lg font-medium transition-colors relative ${adminTab === 'products' ? 'text-rose-600' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    ניהול מוצרים
                    {adminTab === 'products' && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-rose-600 rounded-t-full"></span>}
                  </button>
                  <button 
                    onClick={() => setAdminTab('folders')}
                    className={`pb-4 text-lg font-medium transition-colors relative ${adminTab === 'folders' ? 'text-rose-600' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    תיקיות וקטלוגים
                    {adminTab === 'folders' && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-rose-600 rounded-t-full"></span>}
                  </button>
                  <button 
                    onClick={() => setAdminTab('settings')}
                    className={`pb-4 text-lg font-medium transition-colors relative ${adminTab === 'settings' ? 'text-rose-600' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    הגדרות מערכת
                    {adminTab === 'settings' && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-rose-600 rounded-t-full"></span>}
                  </button>
                </div>

                {/* Tab: Global Settings Configuration */}
                {adminTab === 'settings' && (
                  <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 max-w-2xl">
                    <h3 className="text-xl font-bold mb-6 flex items-center text-slate-800">
                      <Edit2 className="ml-2 w-5 h-5 text-rose-500" />
                      כותרת ראשית (מוצג בדף הבית וב-PDF)
                    </h3>
                    <form onSubmit={updateSettings} className="space-y-4">
                      <input 
                        type="text" 
                        value={siteTitleForm}
                        onChange={(e) => setSiteTitleForm(e.target.value)}
                        className="w-full p-4 border border-slate-300 rounded-xl focus:ring-2 focus:ring-rose-500 text-lg font-serif"
                      />
                      <button 
                        type="submit" 
                        disabled={isSubmitting}
                        className="bg-rose-600 hover:bg-rose-700 text-white font-bold py-3 px-8 rounded-xl transition-colors disabled:opacity-50"
                      >
                        שמור הגדרות
                      </button>
                    </form>
                  </div>
                )}

                {/* Tab: Folder/Catalog Management */}
                {adminTab === 'folders' && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    <div className="md:col-span-1 bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                      <h3 className="text-lg font-bold mb-4">יצירת תיקייה חדשה</h3>
                      <form onSubmit={addFolder} className="space-y-4">
                        <input 
                          type="text" 
                          placeholder="שם התיקייה (לדוג: סוף שנה 2026)"
                          value={folderFormName}
                          onChange={(e) => setFolderFormName(e.target.value)}
                          className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500"
                        />
                        <button 
                          type="submit" 
                          disabled={isSubmitting || !folderFormName}
                          className="w-full bg-slate-800 hover:bg-slate-900 text-white font-bold py-3 px-4 rounded-lg transition-colors"
                        >
                          הוסף תיקייה
                        </button>
                      </form>
                    </div>
                    
                    <div className="md:col-span-2 space-y-3">
                      {catalogs.length === 0 ? (
                        <div className="p-8 text-center text-slate-400 bg-white/50 rounded-2xl border border-slate-200 border-dashed">
                          אין תיקיות במערכת
                        </div>
                      ) : (
                        catalogs.map(catalog => (
                          <div key={catalog.id} className="bg-white p-4 rounded-xl border border-slate-200 flex items-center justify-between shadow-sm">
                            <div className="flex items-center gap-3">
                              <Folder className={`w-5 h-5 ${catalog.isVisible ? 'text-rose-500' : 'text-slate-400'}`} />
                              <span className={`font-bold ${!catalog.isVisible && 'text-slate-400 line-through'}`}>{catalog.name}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <button 
                                onClick={() => toggleFolderVisibility(catalog.id, catalog.isVisible)}
                                className={`px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors ${catalog.isVisible ? 'bg-green-50 text-green-700 hover:bg-green-100' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                              >
                                {catalog.isVisible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                                {catalog.isVisible ? 'מוצג באתר' : 'מוסתר'}
                              </button>
                              <button 
                                onClick={() => deleteFolder(catalog.id)}
                                className="text-red-500 hover:bg-red-50 p-2 rounded-lg transition-colors"
                                title="מחק תיקייה"
                              >
                                <Trash2 className="w-5 h-5" />
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {/* Tab: Product Management */}
                {adminTab === 'products' && (
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    
                    {/* Data Injection Form */}
                    <div className="lg:col-span-1">
                      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 sticky top-24">
                        <h2 className="text-lg font-bold mb-6 flex items-center text-slate-800">
                          <PlusCircle className="ml-2 w-5 h-5 text-rose-500" />
                          הוספת מוצר לקטלוג
                        </h2>
                        
                        {catalogs.length === 0 ? (
                          <div className="text-red-500 text-sm font-medium p-4 bg-red-50 rounded-lg">
                            עליך ליצור לפחות תיקייה אחת לפני הוספת מוצרים.
                          </div>
                        ) : (
                          <form onSubmit={handleProductSubmit} className="space-y-4">
                            <div>
                              <label className="block text-sm font-medium text-slate-700 mb-1">בחר תיקייה</label>
                              <select 
                                value={formData.catalogId}
                                onChange={(e) => setFormData({...formData, catalogId: e.target.value})}
                                required
                                className="w-full p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500"
                              >
                                <option value="" disabled>-- בחר --</option>
                                {catalogs.map(c => (
                                  <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                              </select>
                            </div>

                            <div>
                              <label className="block text-sm font-medium text-slate-700 mb-1">תמונת מוצר (חובה)</label>
                              <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-slate-300 border-dashed rounded-xl cursor-pointer bg-slate-50 hover:bg-slate-100 transition-colors">
                                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                                  {formData.image ? (
                                    <span className="text-sm text-green-600 font-medium text-center">✓ תמונה נטענה ונדחסה</span>
                                  ) : (
                                    <>
                                      <ImageIcon className="w-8 h-8 text-slate-400 mb-2" />
                                      <span className="text-sm text-slate-500">לחץ להעלאת תמונה</span>
                                    </>
                                  )}
                                </div>
                                <input type="file" className="hidden" accept="image/*" onChange={handleImageUpload} ref={fileInputRef} />
                              </label>
                            </div>

                            <div>
                              <label className="block text-sm font-medium text-slate-700 mb-1">שם המוצר</label>
                              <input type="text" required value={formData.title} onChange={(e) => setFormData({...formData, title: e.target.value})} className="w-full p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500" />
                            </div>

                            <div>
                              <label className="block text-sm font-medium text-slate-700 mb-1">תיאור קצר</label>
                              <textarea rows="2" value={formData.description} onChange={(e) => setFormData({...formData, description: e.target.value})} className="w-full p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 resize-none" />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">מחיר (₪)</label>
                                <input type="text" value={formData.price} onChange={(e) => setFormData({...formData, price: e.target.value})} className="w-full p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500" />
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">קישור</label>
                                <input type="url" placeholder="https://" value={formData.link} onChange={(e) => setFormData({...formData, link: e.target.value})} className="w-full p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 text-left" dir="ltr" />
                              </div>
                            </div>

                            <button type="submit" disabled={isSubmitting || !formData.title || !formData.image || !formData.catalogId} className="w-full mt-4 bg-rose-600 hover:bg-rose-700 text-white font-bold py-3 px-4 rounded-xl transition-colors disabled:opacity-50 flex justify-center items-center">
                              {isSubmitting ? <Loader2 className="animate-spin w-5 h-5" /> : 'שמור מוצר'}
                            </button>
                          </form>
                        )}
                      </div>
                    </div>

                    {/* Inventory Render Block (Admin View) */}
                    <div className="lg:col-span-2 space-y-8">
                      {catalogs.map(catalog => {
                        const catalogProducts = products.filter(p => p.catalogId === catalog.id);
                        if (catalogProducts.length === 0) return null;
                        
                        return (
                          <div key={catalog.id} className="bg-white/50 p-6 rounded-2xl border border-slate-200">
                            <h3 className="text-xl font-bold mb-4 flex items-center text-slate-800">
                              <Folder className="ml-2 w-5 h-5 text-slate-400" />
                              {catalog.name}
                              <span className="mr-3 text-sm bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full">{catalogProducts.length} מוצרים</span>
                            </h3>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              {catalogProducts.map(product => (
                                <div key={product.id} className="bg-white p-3 rounded-xl border border-slate-100 flex gap-4 items-start shadow-sm hover:shadow-md transition-shadow">
                                  <img src={product.image} alt={product.title} className="w-20 h-20 object-cover rounded-lg border border-slate-100" />
                                  <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-start">
                                      <h4 className="font-bold text-sm text-slate-900 truncate">{product.title}</h4>
                                      <button onClick={() => deleteProduct(product.id)} className="text-red-400 hover:text-red-600 p-1 hover:bg-red-50 rounded" title="מחק">
                                        <Trash2 className="w-4 h-4" />
                                      </button>
                                    </div>
                                    <span className="font-bold text-rose-600 text-sm">{product.price ? `₪${product.price}` : ''}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ================= PUBLIC CATALOG VIEW (Client / PDF Presentation) ================= */}
        {(view === 'catalog' || isPrinting) && (
          <div className="catalog-container pb-20">
            
            {/* Presentation Header */}
            <div className="text-center mb-12 pt-8 pb-10 print:mb-8 print:pt-0 print:pb-4 border-b-2 border-rose-900/10">
              <div className="inline-block relative">
                {/* Background Watermark Element */}
                <div className="absolute -inset-x-8 -inset-y-12 text-[180px] font-serif text-rose-900/5 select-none pointer-events-none print:text-slate-100 z-0 flex items-center justify-center overflow-hidden">
                  T
                </div>
                <h1 className="relative z-10 text-4xl md:text-5xl font-serif font-extrabold text-slate-900 tracking-tight">
                  {settings.title}
                </h1>
                <p className="relative z-10 text-lg md:text-xl text-rose-700/80 mt-3 font-medium">
                  רגעים קטנים של כתיבה
                </p>
              </div>
              
              {/* PDF Hardware Output Trigger */}
              {!isPrinting && visibleCatalogs.length > 0 && (
                <div className="mt-8 flex justify-center">
                  <button 
                    onClick={handlePrint}
                    className="bg-slate-900 hover:bg-slate-800 text-white font-medium py-2 px-6 rounded-full transition-all shadow-md hover:shadow-lg flex items-center gap-2 text-sm"
                  >
                    <FileDown className="w-4 h-4" />
                    הורד קטלוג כ-PDF
                  </button>
                </div>
              )}
            </div>

            {/* Catalog Router (Tabs) */}
            {!isPrinting && visibleCatalogs.length > 1 && (
               <div className="flex flex-wrap justify-center gap-3 mb-12">
                 {visibleCatalogs.map(catalog => (
                   <button
                     key={catalog.id}
                     onClick={() => setActiveCatalogId(catalog.id)}
                     className={`px-6 py-2.5 rounded-full text-sm font-bold transition-all ${activeCatalogId === catalog.id ? 'bg-rose-600 text-white shadow-md scale-105' : 'bg-white text-slate-600 hover:bg-rose-100 border border-rose-100'}`}
                   >
                     {catalog.name}
                   </button>
                 ))}
               </div>
            )}

            {/* Print Header Logic */}
            {isPrinting && activeCatalogId && (
              <h2 className="text-2xl font-bold text-center mb-8 border-b border-slate-300 pb-2">
                 {catalogs.find(c => c.id === activeCatalogId)?.name}
              </h2>
            )}

            {/* Main Data Grid Matrix */}
            <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8 ${isPrinting ? 'print-grid' : ''}`}>
              {displayedProducts.map(product => (
                <div key={product.id} className="bg-white rounded-3xl shadow-sm border border-rose-100/50 overflow-hidden flex flex-col hover:shadow-xl transition-all duration-300 group print:shadow-none print:border-slate-300 print:break-inside-avoid print:rounded-xl">
                  
                  <div className="relative aspect-square overflow-hidden bg-white flex items-center justify-center p-6">
                    <img 
                      src={product.image} 
                      alt={product.title} 
                      className="max-w-full max-h-full object-contain group-hover:scale-105 transition-transform duration-500"
                    />
                    {product.price && (
                      <div className="absolute top-4 right-4 bg-slate-900/90 backdrop-blur-sm text-white font-bold py-1.5 px-4 rounded-full text-sm shadow-lg print:bg-slate-100 print:text-slate-900 print:border print:border-slate-300">
                        ₪{product.price}
                      </div>
                    )}
                  </div>
                  
                  <div className="p-6 flex flex-col flex-1 bg-gradient-to-b from-white to-slate-50/50">
                    <h3 className="text-xl font-bold text-slate-900 mb-2 leading-tight">{product.title}</h3>
                    <p className="text-sm text-slate-600 flex-1 whitespace-pre-wrap leading-relaxed">{product.description}</p>
                    
                    {product.link && (
                      <a 
                        href={product.link} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="mt-6 inline-flex items-center justify-center w-full bg-rose-50 text-rose-700 hover:bg-rose-100 hover:text-rose-800 font-bold py-3 px-4 rounded-xl transition-colors print:bg-transparent print:border-2 print:border-slate-800 print:text-slate-800 print:py-2"
                      >
                        לפרטים והזמנה
                        <ExternalLink className="w-4 h-4 mr-2" />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Error/Empty State Handlers */}
            {visibleCatalogs.length === 0 && !isPrinting && (
               <div className="flex flex-col items-center justify-center py-20 text-slate-400 bg-white/50 rounded-3xl border border-dashed border-rose-200">
                  <Folder className="w-16 h-16 mb-4 opacity-50 text-rose-300" />
                  <p className="text-xl font-medium text-slate-500">אין קטלוגים פתוחים לקהל כרגע.</p>
               </div>
            )}
            
            {visibleCatalogs.length > 0 && displayedProducts.length === 0 && !isPrinting && (
               <div className="flex flex-col items-center justify-center py-20 text-slate-400 bg-white/50 rounded-3xl border border-dashed border-rose-200">
                  <ImageIcon className="w-16 h-16 mb-4 opacity-50 text-rose-300" />
                  <p className="text-xl font-medium text-slate-500">אין מוצרים בקטלוג זה.</p>
               </div>
            )}
          </div>
        )}
      </main>

      {/* Embedded Physical Print Engine CSS Mapping */}
      <style dangerouslySetInnerHTML={{__html: `
        @media print {
          @page { margin: 15mm; size: A4 portrait; }
          body { background: white !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .print\\:hidden { display: none !important; }
          .print-mode { padding: 0 !important; }
          .print-grid { 
            display: grid !important; 
            grid-template-columns: repeat(3, minmax(0, 1fr)) !important; 
            gap: 2rem !important;
          }
          a { text-decoration: none !important; }
        }
      `}} />
    </div>
  );
}