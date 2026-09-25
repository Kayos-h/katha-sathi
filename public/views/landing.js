/* Khata Sathi - Creative, Bespoke, High-Converting Landing Page
   Showcasing all features: Smart Billing, Real-Time Udharo, Auto Stock Inventory,
   Daily Galla, Offline PWA, Multi-device sync, and Interactive Live Simulators. */
"use strict";

/* global API, ico, toast, escapeHtml, fmtMoney */

const Landing = {
  id: "landing",
  title: "Khata Sathi · Smart Digital Khata & Billing for Nepali Shops",

  render(container) {
    container.innerHTML = `
      <div class="lp-container">
        <!-- Floating Header -->
        <header class="lp-header">
          <div class="lp-header-inner">
            <div class="lp-brand" id="lp-nav-brand">
              <div class="lp-brand-badge">K</div>
              <div class="lp-brand-text">
                <span class="lp-brand-name">Khata Sathi</span>
                <span class="lp-brand-sub">खाता साथी · Digital Nepal</span>
              </div>
            </div>

            <nav class="lp-nav">
              <a href="#lp-features" class="lp-nav-link">Features</a>
              <a href="#lp-demo" class="lp-nav-link">Live Simulator</a>
              <a href="#lp-inventory" class="lp-nav-link">Inventory & Bill</a>
              <a href="#lp-savings" class="lp-nav-link">ROI Calculator</a>
              <a href="#lp-comparison" class="lp-nav-link">Why Us</a>
              <a href="#lp-faq" class="lp-nav-link">FAQ</a>
            </nav>

            <div class="lp-header-actions">
              <button class="lp-btn-theme" id="lp-theme-btn" title="Toggle theme">
                <span class="ico" data-icon="moon"></span>
              </button>
              <button class="lp-btn-ghost" id="lp-btn-signin">Sign In</button>
              <button class="lp-btn-primary" id="lp-btn-start">
                <span>Launch App</span>
                <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fill-rule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>
              </button>
            </div>
          </div>
        </header>

        <!-- Hero Section -->
        <section class="lp-hero">
          <div class="lp-hero-glow"></div>
          <div class="lp-hero-content">
            <div class="lp-pill-badge">
              <span class="lp-flag">🇳🇵</span>
              <span>Crafted for Modern Nepali Retailers, Kirana & Wholesalers</span>
            </div>

            <h1 class="lp-hero-title">
              Say Goodbye to Paper Khata.<br>
              <span class="lp-gradient-text">Make Bills, Track Udharo & Auto-Sync Stock.</span>
            </h1>

            <p class="lp-hero-desc">
              The ultra-fast, offline-ready cloud accounting software built for Nepali shopkeepers.
              Generate thermal receipts in 5 seconds with automatic inventory deduction, collect customer credit effortlessly via WhatsApp, and balance your daily Galla without errors.
            </p>

            <div class="lp-hero-cta-row">
              <button class="lp-btn-hero-primary" id="lp-hero-login-btn">
                <span>Open Khata Sathi</span>
                <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18"><path fill-rule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>
              </button>

              <button class="lp-btn-hero-quick" id="lp-hero-demo-btn">
                <span class="lp-pulse-dot"></span>
                <span>⚡ 1-Click Admin Demo Login</span>
              </button>

              <a href="#lp-demo" class="lp-btn-hero-secondary">
                <span>Try Live Simulator ↓</span>
              </a>
            </div>

            <div class="lp-hero-trust-bar">
              <div class="lp-trust-item">
                <span class="lp-trust-icon">⚡</span>
                <span>5-Sec Bill Creation</span>
              </div>
              <div class="lp-trust-item">
                <span class="lp-trust-icon">📦</span>
                <span>Live Stock Auto-Deduction</span>
              </div>
              <div class="lp-trust-item">
                <span class="lp-trust-icon">📶</span>
                <span>Offline PWA Ready</span>
              </div>
              <div class="lp-trust-item">
                <span class="lp-trust-icon">📲</span>
                <span>Instant WhatsApp Reminders</span>
              </div>
              <div class="lp-trust-item">
                <span class="lp-trust-icon">💰</span>
                <span>Daily Galla Reconciliation</span>
              </div>
            </div>
          </div>

          <!-- Hero Interactive Simulation Card -->
          <div class="lp-hero-interactive-wrap" id="lp-demo">
            <div class="lp-sim-header">
              <div class="lp-sim-dots">
                <span class="lp-sim-dot red"></span>
                <span class="lp-sim-dot yellow"></span>
                <span class="lp-sim-dot green"></span>
              </div>
              <div class="lp-sim-title">
                <span>🎮 Interactive Live Khata Simulator — Try it right now!</span>
              </div>
              <div class="lp-sim-badge">LIVE DEMO</div>
            </div>

            <div class="lp-sim-body">
              <div class="lp-sim-left">
                <div class="lp-sim-field-group">
                  <label class="lp-sim-label">👤 Customer / Party Name</label>
                  <div class="lp-sim-customer-pills" id="lp-sim-cust-pills">
                    <button class="lp-cust-pill active" data-name="Ramesh Sharma" data-phone="9841234567" data-prev="1450">Ramesh Sharma (Rs. 1,450 old)</button>
                    <button class="lp-cust-pill" data-name="Sita Gurung" data-phone="9801987654" data-prev="0">Sita Gurung (New)</button>
                    <button class="lp-cust-pill" data-name="Hari Poudel" data-phone="9851029384" data-prev="3200">Hari Poudel (Rs. 3,200 old)</button>
                  </div>
                </div>

                <div class="lp-sim-field-group">
                  <label class="lp-sim-label">📦 Quick Add Stock Items (Click to Add to Bill)</label>
                  <div class="lp-sim-stock-tags" id="lp-sim-stock-tags">
                    <button class="lp-stock-tag" data-name="Wai Wai Box (30 pcs)" data-rate="750" data-stock="24">
                      <span>🍜 Wai Wai Box</span>
                      <b>Rs. 750</b>
                      <small class="lp-tag-stock" id="stock-tag-0">24 in stock</small>
                    </button>
                    <button class="lp-stock-tag" data-name="Sunflow Sunflower Oil 1L" data-rate="240" data-stock="18">
                      <span>🛢️ Sunflow Oil 1L</span>
                      <b>Rs. 240</b>
                      <small class="lp-tag-stock" id="stock-tag-1">18 in stock</small>
                    </button>
                    <button class="lp-stock-tag" data-name="Hulas Basmati Rice 25kg" data-rate="2900" data-stock="10">
                      <span>🍚 Basmati Rice 25kg</span>
                      <b>Rs. 2,900</b>
                      <small class="lp-tag-stock" id="stock-tag-2">10 in stock</small>
                    </button>
                    <button class="lp-stock-tag" data-name="Sugar (चिनी) 1kg" data-rate="95" data-stock="65">
                      <span>🧂 Sugar 1kg</span>
                      <b>Rs. 95</b>
                      <small class="lp-tag-stock" id="stock-tag-3">65 in stock</small>
                    </button>
                    <button class="lp-stock-tag" data-name="Tokla Gold Tea 500g" data-rate="320" data-stock="14">
                      <span>🍵 Tokla Tea 500g</span>
                      <b>Rs. 320</b>
                      <small class="lp-tag-stock" id="stock-tag-4">14 in stock</small>
                    </button>
                  </div>
                </div>

                <!-- Current Bill Items Table -->
                <div class="lp-sim-table-wrap">
                  <table class="lp-sim-table">
                    <thead>
                      <tr>
                        <th>Item / Description</th>
                        <th style="width:70px;text-align:center">Qty</th>
                        <th style="width:90px;text-align:right">Rate (Rs)</th>
                        <th style="width:90px;text-align:right">Amount</th>
                        <th style="width:40px"></th>
                      </tr>
                    </thead>
                    <tbody id="lp-sim-items-body">
                      <!-- populated dynamically -->
                    </tbody>
                  </table>
                </div>
              </div>

              <!-- Simulator Right Summary & Payment -->
              <div class="lp-sim-right">
                <div class="lp-sim-receipt-card">
                  <div class="lp-rc-header">
                    <div class="lp-rc-store">RAMESH KIRANA & GENERAL STORE</div>
                    <div class="lp-rc-sub">New Road, Kathmandu • PAN: 601294812</div>
                    <div class="lp-rc-divider"></div>
                  </div>

                  <div class="lp-rc-row">
                    <span>Customer:</span>
                    <b id="lp-rc-cust">Ramesh Sharma</b>
                  </div>
                  <div class="lp-rc-row">
                    <span>Previous Udharo:</span>
                    <span id="lp-rc-prev">Rs. 1,450</span>
                  </div>
                  <div class="lp-rc-row">
                    <span>Current Bill Subtotal:</span>
                    <b id="lp-rc-subtotal" class="lp-rc-highlight">Rs. 0</b>
                  </div>

                  <div class="lp-sim-pay-section">
                    <label class="lp-sim-label">Payment Mode:</label>
                    <div class="lp-pay-mode-pills" id="lp-sim-pay-modes">
                      <button class="lp-pay-pill active" data-mode="full">Full Paid</button>
                      <button class="lp-pay-pill" data-mode="credit">Full Udharo</button>
                      <button class="lp-pay-pill" data-mode="partial">Partial</button>
                    </div>

                    <div class="lp-pay-input-row" id="lp-sim-paid-row">
                      <label>Paid Now (Rs.):</label>
                      <input type="number" id="lp-sim-paid-input" class="lp-sim-input" value="0">
                    </div>
                  </div>

                  <div class="lp-rc-divider"></div>

                  <div class="lp-rc-row lp-rc-total-row">
                    <span>New Balance to Pay:</span>
                    <b id="lp-rc-balance" class="lp-rc-neg">Rs. 1,450</b>
                  </div>

                  <div class="lp-sim-actions">
                    <button class="lp-btn-sim-action primary" id="lp-sim-save-btn">
                      <span>✓ Save Bill & Deduct Stock</span>
                    </button>
                    <button class="lp-btn-sim-action secondary" id="lp-sim-wa-btn">
                      <span>📲 WhatsApp Reminder Preview</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- Core Feature Showcase -->
        <section class="lp-section" id="lp-features">
          <div class="lp-section-header">
            <div class="lp-section-pill">EVERYTHING YOU NEED</div>
            <h2 class="lp-section-title">Built specifically for how Nepali shops operate.</h2>
            <p class="lp-section-desc">No bulky software, no complex accounting jargon. Just 5 clean modules that save you hours every single day.</p>
          </div>

          <!-- Feature Cards Grid -->
          <div class="lp-feature-grid">
            <!-- Feature 1: Smart Bill Maker -->
            <div class="lp-feat-card highlight">
              <div class="lp-feat-icon-wrap blue">
                <span class="ico" data-icon="doc"></span>
              </div>
              <div class="lp-feat-badge">⚡ 5-Second Checkout</div>
              <h3 class="lp-feat-title">Smart Bill Maker & Stock Autofill</h3>
              <p class="lp-feat-desc">
                Type 2 letters of any product and Khata Sathi instantly autocompletes the name, rate, and in-stock quantity. Computes totals, taxes, and discounts with zero math errors.
              </p>
              <ul class="lp-feat-list">
                <li>Instant thermal printer (58mm/80mm) & A4 invoice format</li>
                <li>Live in-stock indicator on each line item</li>
                <li>1-click stock item modal picker for rapid catalog browsing</li>
              </ul>
            </div>

            <!-- Feature 2: Automated Inventory -->
            <div class="lp-feat-card">
              <div class="lp-feat-icon-wrap emerald">
                <span class="ico" data-icon="box"></span>
              </div>
              <div class="lp-feat-badge">📦 Real-Time Deduction</div>
              <h3 class="lp-feat-title">Automatic Inventory & Stock Alerts</h3>
              <p class="lp-feat-desc">
                Never lose count of what’s on your shelf. As soon as a bill is generated, product stock levels are deducted automatically.
              </p>
              <ul class="lp-feat-list">
                <li>Low stock visual warnings before you run out of items</li>
                <li>Profit margin calculations (Cost price vs Selling price)</li>
                <li>Full inventory audit logs for every adjustment</li>
              </ul>
            </div>

            <!-- Feature 3: Real-Time Udharo Ledger -->
            <div class="lp-feat-card">
              <div class="lp-feat-icon-wrap amber">
                <span class="ico" data-icon="people"></span>
              </div>
              <div class="lp-feat-badge">👥 Zero Lost Credit</div>
              <h3 class="lp-feat-title">Real-Time Udharo (Credit) Ledger</h3>
              <p class="lp-feat-desc">
                Track every rupee owed by customers. Stop flipping through old paper ledgers to find who owes what.
              </p>
              <ul class="lp-feat-list">
                <li>Customer-wise balance cards with color-coded status</li>
                <li>1-click WhatsApp payment reminders with detailed bill breakdown</li>
                <li>Instant partial or full payment entry with galla sync</li>
              </ul>
            </div>

            <!-- Feature 4: Daily Galla Reconciliation -->
            <div class="lp-feat-card">
              <div class="lp-feat-icon-wrap violet">
                <span class="ico" data-icon="wallet"></span>
              </div>
              <div class="lp-feat-badge">💰 Cash Drawer Control</div>
              <h3 class="lp-feat-title">Daily Galla & Expense Tracking</h3>
              <p class="lp-feat-desc">
                Track opening cash, cash sales, eSewa/Fonepay QR payments, and shop expenses (tea, electricity, rent) in one tap.
              </p>
              <ul class="lp-feat-list">
                <li>End-of-day drawer reconciliation with zero discrepancies</li>
                <li>Categorized expense recording in seconds</li>
                <li>Daily net cash profit summary</li>
              </ul>
            </div>

            <!-- Feature 5: Multi-Device Sync & Offline PWA -->
            <div class="lp-feat-card">
              <div class="lp-feat-icon-wrap cyan">
                <span class="ico" data-icon="qr"></span>
              </div>
              <div class="lp-feat-badge">📶 Always Works</div>
              <h3 class="lp-feat-title">Multi-Device Live Sync + Offline Mode</h3>
              <p class="lp-feat-desc">
                Use your desktop PC at the counter, your Android phone on delivery, and your iPad in the godown. Everything syncs instantaneously.
              </p>
              <ul class="lp-feat-list">
                <li>Works completely offline if your Wi-Fi or electricity drops</li>
                <li>Scan shop QR code to connect any staff phone in 2 seconds</li>
                <li>Bank-grade encrypted cloud database backup</li>
              </ul>
            </div>

            <!-- Feature 6: Nepali SME Ready -->
            <div class="lp-feat-card">
              <div class="lp-feat-icon-wrap red">
                <span class="ico" data-icon="store"></span>
              </div>
              <div class="lp-feat-badge">🇳🇵 100% Nepali Ready</div>
              <h3 class="lp-feat-title">Nepali Currency, PAN & Easy Language</h3>
              <p class="lp-feat-desc">
                Designed for everyday Nepali shop owners. Simple Devanagari labels, Nepali Rupee (Rs.) formatting, and PAN tax headers.
              </p>
              <ul class="lp-feat-list">
                <li>No accounting knowledge or expensive training needed</li>
                <li>Customizable shop branding, address, and phone numbers</li>
                <li>Quick 1-click admin login demo to try right away</li>
              </ul>
            </div>
          </div>
        </section>

        <!-- Deep Dive Interactive Tabs Section -->
        <section class="lp-section lp-section-alt" id="lp-inventory">
          <div class="lp-section-header">
            <div class="lp-section-pill">DEEP DIVE</div>
            <h2 class="lp-section-title">See Khata Sathi in Action</h2>
            <p class="lp-section-desc">Explore how seamless each workflow is designed to be.</p>
          </div>

          <div class="lp-tabs-container">
            <div class="lp-tab-nav" id="lp-workflow-tabs">
              <button class="lp-tab-btn active" data-tab="tab-billing">
                <span class="ico" data-icon="doc"></span>
                <span>Smart Billing</span>
              </button>
              <button class="lp-tab-btn" data-tab="tab-inventory">
                <span class="ico" data-icon="box"></span>
                <span>Stock & Inventory</span>
              </button>
              <button class="lp-tab-btn" data-tab="tab-udharo">
                <span class="ico" data-icon="people"></span>
                <span>Udharo Ledger</span>
              </button>
              <button class="lp-tab-btn" data-tab="tab-galla">
                <span class="ico" data-icon="wallet"></span>
                <span>Galla Cash Drawer</span>
              </button>
            </div>

            <div class="lp-tab-content-wrap">
              <!-- Tab 1 Content -->
              <div class="lp-tab-pane active" id="tab-billing">
                <div class="lp-pane-grid">
                  <div class="lp-pane-info">
                    <span class="lp-pane-tag">Lightning Fast Checkout</span>
                    <h3>Generate Bills & Invoices in Under 5 Seconds</h3>
                    <p>Forget slow POS systems that take 2 minutes per customer. Khata Sathi lets you add items with quick autocomplete, customize rates, and print or WhatsApp customer bills instantly.</p>
                    <div class="lp-pane-points">
                      <div class="lp-pp"><span class="lp-check">✓</span> Inline stock autocomplete with remaining qty counter</div>
                      <div class="lp-pp"><span class="lp-check">✓</span> Automatic line totals, subtotal, and remaining balance math</div>
                      <div class="lp-pp"><span class="lp-check">✓</span> Thermal printer ready with 1-click print or PDF download</div>
                    </div>
                    <button class="lp-btn-primary lp-pane-btn" id="lp-pane-cta-1">Try Bill Maker Now →</button>
                  </div>
                  <div class="lp-pane-visual">
                    <div class="lp-mock-window">
                      <div class="lp-mw-bar"><span class="lp-mw-dot"></span><span>Make Bill — Quick Checkout</span></div>
                      <div class="lp-mw-content">
                        <div class="lp-mock-row">
                          <div class="lp-mock-input">Customer: <b>Hari Bahadur (9841...)</b></div>
                          <div class="lp-mock-badge green">Stock Sync: ACTIVE</div>
                        </div>
                        <div class="lp-mock-line-item">
                          <div><b>Wai Wai Quick 75g</b><br><small>12 pcs @ Rs. 25.00</small></div>
                          <div class="lp-mock-amt">Rs. 300.00</div>
                        </div>
                        <div class="lp-mock-line-item">
                          <div><b>Sunflow Oil 1L</b><br><small>2 bottles @ Rs. 240.00</small></div>
                          <div class="lp-mock-amt">Rs. 480.00</div>
                        </div>
                        <div class="lp-mock-total-row">
                          <span>Total Amount:</span>
                          <b>Rs. 780.00</b>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Tab 2 Content -->
              <div class="lp-tab-pane" id="tab-inventory">
                <div class="lp-pane-grid">
                  <div class="lp-pane-info">
                    <span class="lp-pane-tag">Real-Time Inventory</span>
                    <h3>Keep 100% Accurate Stock Without Excel Sheets</h3>
                    <p>Track wholesale cost prices, retail selling rates, profit margins, and stock thresholds across your entire catalog. Automatic stock deduction prevents overselling and shrinkage.</p>
                    <div class="lp-pane-points">
                      <div class="lp-pp"><span class="lp-check">✓</span> Profit margin calculation on every product SKU</div>
                      <div class="lp-pp"><span class="lp-check">✓</span> Visual color-coded stock health badges (In Stock / Low / Out)</div>
                      <div class="lp-pp"><span class="lp-check">✓</span> Audit trails for restocks, purchases, and bill deductions</div>
                    </div>
                    <button class="lp-btn-primary lp-pane-btn" id="lp-pane-cta-2">View Stock System →</button>
                  </div>
                  <div class="lp-pane-visual">
                    <div class="lp-mock-window">
                      <div class="lp-mw-bar"><span class="lp-mw-dot"></span><span>Inventory Dashboard</span></div>
                      <div class="lp-mw-content">
                        <div class="lp-mock-inv-item">
                          <div class="lp-inv-avatar">🍚</div>
                          <div class="lp-inv-details">
                            <b>Hulas Basmati Rice 25kg</b>
                            <small>Buy: Rs. 2,600 | Sell: Rs. 2,900</small>
                          </div>
                          <div class="lp-inv-badge green">18 Bags (Healthy)</div>
                        </div>
                        <div class="lp-mock-inv-item">
                          <div class="lp-inv-avatar">🛢️</div>
                          <div class="lp-inv-details">
                            <b>Sunflow Oil 1L</b>
                            <small>Buy: Rs. 210 | Sell: Rs. 240</small>
                          </div>
                          <div class="lp-inv-badge yellow">4 Left (Low Stock)</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Tab 3 Content -->
              <div class="lp-tab-pane" id="tab-udharo">
                <div class="lp-pane-grid">
                  <div class="lp-pane-info">
                    <span class="lp-pane-tag">Customer Credit (Udharo)</span>
                    <h3>Collect Udharo 3x Faster With Zero Embarrassment</h3>
                    <p>No more uncomfortable phone calls or forgotten debt. Khata Sathi organizes customer ledgers neatly and generates polite, professional WhatsApp reminders in one click.</p>
                    <div class="lp-pane-points">
                      <div class="lp-pp"><span class="lp-check">✓</span> Instant customer balance timeline (Bills vs Payments)</div>
                      <div class="lp-pp"><span class="lp-check">✓</span> Pre-written friendly WhatsApp / SMS payment slips</div>
                      <div class="lp-pp"><span class="lp-check">✓</span> Record cash, Fonepay, or bank transfer payments in 1 tap</div>
                    </div>
                    <button class="lp-btn-primary lp-pane-btn" id="lp-pane-cta-3">Manage Customer Ledgers →</button>
                  </div>
                  <div class="lp-pane-visual">
                    <div class="lp-mock-window">
                      <div class="lp-mw-bar"><span class="lp-mw-dot"></span><span>Customer Ledger Statement</span></div>
                      <div class="lp-mw-content">
                        <div class="lp-mock-ledger-card">
                          <div class="lp-mlc-head">
                            <div><b>Ramesh Sharma</b><br><small>📱 9841234567 • Kathmandu</small></div>
                            <div class="lp-mlc-bal">Rs. 3,450.00<br><small>Total Due</small></div>
                          </div>
                          <div class="lp-mlc-btn">📲 Send WhatsApp Reminder Slip</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Tab 4 Content -->
              <div class="lp-tab-pane" id="tab-galla">
                <div class="lp-pane-grid">
                  <div class="lp-pane-info">
                    <span class="lp-pane-tag">Daily Cash Register</span>
                    <h3>Never Lose A Rupee at Shop Closing Time</h3>
                    <p>Match your physical drawer cash with digital transactions. Log tea, transport, and supplier expenses instantly so your net daily profits are crystal clear.</p>
                    <div class="lp-pane-points">
                      <div class="lp-pp"><span class="lp-check">✓</span> Opening drawer cash + Daily sales calculation</div>
                      <div class="lp-pp"><span class="lp-check">✓</span> Cash drawer closing balance discrepancy checker</div>
                      <div class="lp-pp"><span class="lp-check">✓</span> Separate Cash, QR / Fonepay, and Credit breakdown</div>
                    </div>
                    <button class="lp-btn-primary lp-pane-btn" id="lp-pane-cta-4">Explore Galla Tracker →</button>
                  </div>
                  <div class="lp-pane-visual">
                    <div class="lp-mock-window">
                      <div class="lp-mw-bar"><span class="lp-mw-dot"></span><span>Daily Galla Reconciliation</span></div>
                      <div class="lp-mw-content">
                        <div class="lp-mock-galla-stat">
                          <span>Opening Cash:</span>
                          <b>Rs. 10,000.00</b>
                        </div>
                        <div class="lp-mock-galla-stat">
                          <span>Cash Sales Today:</span>
                          <b class="green">+ Rs. 18,450.00</b>
                        </div>
                        <div class="lp-mock-galla-stat">
                          <span>Shop Expenses (Tea/Rent):</span>
                          <b class="red">- Rs. 1,200.00</b>
                        </div>
                        <div class="lp-mock-galla-total">
                          <span>Expected In Drawer:</span>
                          <b>Rs. 27,250.00</b>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- Old Paper Khata vs Khata Sathi Comparison -->
        <section class="lp-section" id="lp-comparison">
          <div class="lp-section-header">
            <div class="lp-section-pill">TRANSFORMATION</div>
            <h2 class="lp-section-title">The Difference is Night and Day</h2>
            <p class="lp-section-desc">Why hundreds of Nepali shopkeepers are ditching paper red registers for Khata Sathi.</p>
          </div>

          <div class="lp-comp-table-wrap">
            <table class="lp-comp-table">
              <thead>
                <tr>
                  <th style="width:36%">Aspect</th>
                  <th style="width:32%" class="lp-th-bad">❌ Old Paper Red Khata</th>
                  <th style="width:32%" class="lp-th-good">✅ Khata Sathi Cloud</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><b>Billing Speed</b></td>
                  <td class="lp-td-bad">Slow manual writing with calculator (~2-3 mins/bill)</td>
                  <td class="lp-td-good"><b>5-second billing</b> with instant stock autocomplete & print</td>
                </tr>
                <tr>
                  <td><b>Stock & Inventory</b></td>
                  <td class="lp-td-bad">Manual counting every month; frequent shrinkage</td>
                  <td class="lp-td-good"><b>Live auto-deduction</b> on every sale with low-stock alerts</td>
                </tr>
                <tr>
                  <td><b>Udharo Tracking</b></td>
                  <td class="lp-td-bad">Pages tear, lost entries, forgotten credit payments</td>
                  <td class="lp-td-good"><b>100% accurate ledgers</b> with 1-tap WhatsApp reminders</td>
                </tr>
                <tr>
                  <td><b>Daily Galla Balancing</b></td>
                  <td class="lp-td-bad">Headache at night trying to figure out missing cash</td>
                  <td class="lp-td-good"><b>Automated daily reconciliation</b> of Cash, QR, and Expenses</td>
                </tr>
                <tr>
                  <td><b>Device & Remote Access</b></td>
                  <td class="lp-td-bad">Must physically be present in the shop to see records</td>
                  <td class="lp-td-good"><b>Live cloud sync</b> across mobile, tablet, and PC anywhere</td>
                </tr>
                <tr>
                  <td><b>Internet Disconnects</b></td>
                  <td class="lp-td-bad">N/A</td>
                  <td class="lp-td-good"><b>Full Offline Mode</b> — continues working without internet</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- Interactive ROI & Savings Calculator -->
        <section class="lp-section lp-section-alt" id="lp-savings">
          <div class="lp-section-header">
            <div class="lp-section-pill">BUSINESS IMPACT</div>
            <h2 class="lp-section-title">Calculate Your Monthly Time & Money Saved</h2>
            <p class="lp-section-desc">See how much faster and more profitable your shop becomes with Khata Sathi.</p>
          </div>

          <div class="lp-calc-wrap">
            <div class="lp-calc-controls">
              <div class="lp-slider-group">
                <div class="lp-slider-header">
                  <label>Daily Customer Bills Generated:</label>
                  <b id="lp-calc-bills-val" class="lp-slider-val">35 bills / day</b>
                </div>
                <input type="range" id="lp-calc-bills" min="5" max="250" value="35" class="lp-range-slider">
              </div>

              <div class="lp-slider-group" style="margin-top:24px">
                <div class="lp-slider-header">
                  <label>Monthly Udharo (Credit) Customers:</label>
                  <b id="lp-calc-cust-val" class="lp-slider-val">40 customers</b>
                </div>
                <input type="range" id="lp-calc-cust" min="5" max="300" value="40" class="lp-range-slider">
              </div>
            </div>

            <div class="lp-calc-results-grid">
              <div class="lp-calc-card">
                <div class="lp-cc-icon">⏱️</div>
                <div class="lp-cc-val" id="lp-res-time">~26 Hours</div>
                <div class="lp-cc-label">Bookkeeping Time Saved / Mo</div>
                <div class="lp-cc-sub">Spend less time on calculator, more with family</div>
              </div>

              <div class="lp-calc-card highlight">
                <div class="lp-cc-icon">💰</div>
                <div class="lp-cc-val" id="lp-res-udharo">Rs. 18,500+</div>
                <div class="lp-cc-label">Recovered Missed Credit / Mo</div>
                <div class="lp-cc-sub">Zero forgotten debts with timely WhatsApp slips</div>
              </div>

              <div class="lp-calc-card">
                <div class="lp-cc-icon">🚀</div>
                <div class="lp-cc-val">3.5x Faster</div>
                <div class="lp-cc-label">Counter Checkout Speed</div>
                <div class="lp-cc-sub">Shorter lines and happier customers in your shop</div>
              </div>
            </div>
          </div>
        </section>

        <!-- Testimonials -->
        <section class="lp-section">
          <div class="lp-section-header">
            <div class="lp-section-pill">TESTIMONIALS</div>
            <h2 class="lp-section-title">Trusted by Shopkeepers Across Nepal</h2>
            <p class="lp-section-desc">Hear what real owners from Kathmandu, Pokhara, and Butwal have to say.</p>
          </div>

          <div class="lp-test-grid">
            <div class="lp-test-card">
              <div class="lp-test-stars">★★★★★</div>
              <p class="lp-test-quote">
                "पहिले हिसाब मिलाउन राती १ घण्टा बस्नुपर्थ्यो। खाता साथीले बिल बनाउने बित्तिकै स्टक पनि घट्छ र उधारो हिसाब पनि आफै बस्छ। एकदमै सजिलो!"
              </p>
              <div class="lp-test-author">
                <div class="lp-test-avatar">RK</div>
                <div>
                  <b>Ramesh Karki</b>
                  <small>Karki Kirana & Wholesale, New Road, Kathmandu</small>
                </div>
              </div>
            </div>

            <div class="lp-test-card">
              <div class="lp-test-stars">★★★★★</div>
              <p class="lp-test-quote">
                "The WhatsApp reminder button is a lifesaver. Customers pay their balance politely without any dispute because the entire bill breakdown is clear."
              </p>
              <div class="lp-test-author">
                <div class="lp-test-avatar">SP</div>
                <div>
                  <b>Sunita Poudel</b>
                  <small>Poudel Electronics & Hardware, Pokhara</small>
                </div>
              </div>
            </div>

            <div class="lp-test-card">
              <div class="lp-test-stars">★★★★★</div>
              <p class="lp-test-quote">
                "Offline हुँदा पनि मजाले चल्छ। मेरो पसलमा बत्ती जाँदा पनि मोबाइलबाटै बिल काट्न मिल्छ। Best app for Nepali shop owners."
              </p>
              <div class="lp-test-author">
                <div class="lp-test-avatar">BT</div>
                <div>
                  <b>Bikash Thapa</b>
                  <small>Thapa General Store, Itahari</small>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- FAQ Section -->
        <section class="lp-section lp-section-alt" id="lp-faq">
          <div class="lp-section-header">
            <div class="lp-section-pill">FAQ</div>
            <h2 class="lp-section-title">Frequently Asked Questions</h2>
            <p class="lp-section-desc">Got questions? We have clear answers.</p>
          </div>

          <div class="lp-faq-container">
            <details class="lp-faq-item" open>
              <summary class="lp-faq-q">What happens if my shop loses internet connection?</summary>
              <div class="lp-faq-a">
                Khata Sathi is built as an offline-first Progressive Web App (PWA). You can continue making bills, checking stock, and recording payments even without an active internet connection. Everything syncs back safely to the cloud as soon as you reconnect.
              </div>
            </details>

            <details class="lp-faq-item">
              <summary class="lp-faq-q">Can I use Khata Sathi on both my counter PC and my mobile phone?</summary>
              <div class="lp-faq-a">
                Yes, absolutely! Khata Sathi supports real-time multi-device cloud synchronization. You can keep the dashboard or bill maker open on your desktop POS at the counter while checking inventory or entering customer payments on your mobile phone on the go.
              </div>
            </details>

            <details class="lp-faq-item">
              <summary class="lp-faq-q">How does stock auto-deduction work when making a bill?</summary>
              <div class="lp-faq-a">
                When adding items in Make Bill, Khata Sathi autocompletes your product name and shows you the exact available stock. Once you save the bill, the sold quantity is deducted from your inventory instantly and logged into your inventory audit ledger.
              </div>
            </details>

            <details class="lp-faq-item">
              <summary class="lp-faq-q">Does it support thermal receipt printers?</summary>
              <div class="lp-faq-a">
                Yes! Khata Sathi is optimized for standard 58mm and 80mm thermal receipt printers, as well as full-page A4 invoices with your custom shop name, address, PAN number, and QR codes.
              </div>
            </details>

            <details class="lp-faq-item">
              <summary class="lp-faq-q">Is my shop data private and securely stored?</summary>
              <div class="lp-faq-a">
                All data is encrypted in transit and securely housed on dedicated PostgreSQL cloud clusters with automated daily backups. Only you and authorized staff can access your shop records.
              </div>
            </details>
          </div>
        </section>

        <!-- Final CTA Banner -->
        <section class="lp-final-cta">
          <div class="lp-fc-content">
            <div class="lp-pill-badge">🚀 START IN 60 SECONDS</div>
            <h2 class="lp-fc-title">Ready to modernize your shop today?</h2>
            <p class="lp-fc-desc">Join hundreds of Nepali shop owners who manage their bills, inventory, and udharo effortlessly.</p>
            <div class="lp-fc-btns">
              <button class="lp-btn-hero-primary" id="lp-final-login-btn">
                <span>Open Khata Sathi Free</span>
                <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18"><path fill-rule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>
              </button>
              <button class="lp-btn-hero-quick" id="lp-final-demo-btn">
                <span>⚡ 1-Click Admin Quick Login</span>
              </button>
            </div>
          </div>
        </section>

        <!-- Footer -->
        <footer class="lp-footer">
          <div class="lp-footer-inner">
            <div class="lp-foot-brand">
              <div class="lp-brand-badge">K</div>
              <div>
                <b>Khata Sathi</b><br>
                <small>नेपालको आफ्नै डिजिटल खाता र बिलिङ्ग प्रणाली</small>
              </div>
            </div>
            <div class="lp-foot-links">
              <a href="#lp-features">Features</a>
              <a href="#lp-demo">Interactive Demo</a>
              <a href="#lp-inventory">Stock & Billing</a>
              <a href="#lp-savings">Calculator</a>
              <a href="#lp-faq">FAQ</a>
            </div>
            <div class="lp-foot-copy">
              © 2026 Khata Sathi. All rights reserved. • Hosted at <a href="https://kathasathi.hlenterprises.com.np" target="_blank" style="color:var(--accent);text-decoration:underline">kathasathi.hlenterprises.com.np</a>
            </div>
          </div>
        </footer>
      </div>
    `;

    this.bindEvents(container);
    this.initSimulator(container);
    this.initCalculator(container);
    this.initTabs(container);
  },

  bindEvents(container) {
    // Navigation to login/signup
    const openLogin = () => {
      if (window.App) {
        window.App.showAuth("login");
      }
    };
    const openSignup = () => {
      if (window.App) {
        window.App.showAuth("signup");
      }
    };
    const quickAdmin = () => {
      if (window.App) {
        window.App.showAuth("login");
        setTimeout(() => {
          const emailInput = document.getElementById("auth-email");
          const passInput = document.getElementById("auth-pass");
          const submitBtn = document.getElementById("auth-submit");
          if (emailInput && passInput) {
            emailInput.value = "admin";
            passInput.value = "admin";
            if (submitBtn) submitBtn.click();
          }
        }, 100);
      }
    };

    container.querySelector("#lp-btn-signin").onclick = openLogin;
    container.querySelector("#lp-btn-start").onclick = openSignup;
    container.querySelector("#lp-hero-login-btn").onclick = openLogin;
    container.querySelector("#lp-hero-demo-btn").onclick = quickAdmin;
    container.querySelector("#lp-final-login-btn").onclick = openLogin;
    container.querySelector("#lp-final-demo-btn").onclick = quickAdmin;

    const ctaBtns = ["#lp-pane-cta-1", "#lp-pane-cta-2", "#lp-pane-cta-3", "#lp-pane-cta-4"];
    ctaBtns.forEach((sel) => {
      const b = container.querySelector(sel);
      if (b) b.onclick = openLogin;
    });

    // Theme toggle
    const themeBtn = container.querySelector("#lp-theme-btn");
    if (themeBtn && window.App) {
      themeBtn.onclick = () => window.App.toggleTheme();
    }

    // Paint icons
    if (window.App && window.App.paintIcons) {
      window.App.paintIcons();
    }
  },

  /* ---------- Live Interactive Simulator Logic ---------- */
  initSimulator(container) {
    const simState = {
      customer: "Ramesh Sharma",
      phone: "9841234567",
      prevBalance: 1450,
      items: [
        { name: "Wai Wai Box (30 pcs)", qty: 1, rate: 750, stock: 24 },
        { name: "Sunflow Sunflower Oil 1L", qty: 2, rate: 240, stock: 18 }
      ],
      paymentMode: "full", // 'full', 'credit', 'partial'
      paidAmount: 1230
    };

    const itemsBody = container.querySelector("#lp-sim-items-body");
    const custPills = container.querySelectorAll(".lp-cust-pill");
    const stockTags = container.querySelectorAll(".lp-stock-tag");
    const payPills = container.querySelectorAll(".lp-pay-pill");
    const paidInput = container.querySelector("#lp-sim-paid-input");
    const paidRow = container.querySelector("#lp-sim-paid-row");

    const custNameEl = container.querySelector("#lp-rc-cust");
    const prevBalEl = container.querySelector("#lp-rc-prev");
    const subtotalEl = container.querySelector("#lp-rc-subtotal");
    const balanceEl = container.querySelector("#lp-rc-balance");

    const renderItems = () => {
      if (simState.items.length === 0) {
        itemsBody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--ink-3)">No items in bill yet. Click the stock items above to add!</td></tr>`;
      } else {
        itemsBody.innerHTML = simState.items.map((it, idx) => {
          const amt = it.qty * it.rate;
          return `
            <tr>
              <td>
                <div class="lp-sim-it-name">${escapeHtml(it.name)}</div>
                <small class="lp-sim-it-stock">In stock: ${it.stock - it.qty} left</small>
              </td>
              <td style="text-align:center">
                <input type="number" min="1" max="${it.stock}" value="${it.qty}" data-idx="${idx}" class="lp-sim-qty-input">
              </td>
              <td style="text-align:right">Rs. ${it.rate.toLocaleString()}</td>
              <td style="text-align:right;font-weight:600">Rs. ${amt.toLocaleString()}</td>
              <td style="text-align:center">
                <button class="lp-sim-del-btn" data-del="${idx}">✕</button>
              </td>
            </tr>
          `;
        }).join("");
      }

      // Calculate subtotal
      const subtotal = simState.items.reduce((acc, it) => acc + (it.qty * it.rate), 0);
      subtotalEl.textContent = "Rs. " + subtotal.toLocaleString();

      // Recalculate payment & balance
      if (simState.paymentMode === "full") {
        simState.paidAmount = subtotal;
        paidInput.value = subtotal;
      } else if (simState.paymentMode === "credit") {
        simState.paidAmount = 0;
        paidInput.value = 0;
      }

      const totalDue = simState.prevBalance + subtotal;
      const finalRemaining = totalDue - simState.paidAmount;

      balanceEl.textContent = "Rs. " + finalRemaining.toLocaleString();
      balanceEl.className = finalRemaining > 0 ? "lp-rc-neg" : "lp-rc-pos";

      // Attach Qty & Delete events
      itemsBody.querySelectorAll(".lp-sim-qty-input").forEach((inp) => {
        inp.onchange = (e) => {
          const idx = parseInt(e.target.getAttribute("data-idx"), 10);
          const val = Math.max(1, parseInt(e.target.value, 10) || 1);
          simState.items[idx].qty = val;
          renderItems();
        };
      });

      itemsBody.querySelectorAll(".lp-sim-del-btn").forEach((btn) => {
        btn.onclick = () => {
          const idx = parseInt(btn.getAttribute("data-del"), 10);
          simState.items.splice(idx, 1);
          renderItems();
        };
      });
    };

    // Customer switch
    custPills.forEach((p) => {
      p.onclick = () => {
        custPills.forEach((x) => x.classList.remove("active"));
        p.classList.add("active");
        simState.customer = p.getAttribute("data-name");
        simState.phone = p.getAttribute("data-phone");
        simState.prevBalance = parseFloat(p.getAttribute("data-prev") || 0);

        custNameEl.textContent = simState.customer;
        prevBalEl.textContent = "Rs. " + simState.prevBalance.toLocaleString();
        renderItems();
      };
    });

    // Add stock item click
    stockTags.forEach((tag, tIdx) => {
      tag.onclick = () => {
        const name = tag.getAttribute("data-name");
        const rate = parseFloat(tag.getAttribute("data-rate"));
        const stock = parseInt(tag.getAttribute("data-stock"), 10);

        const exist = simState.items.find((x) => x.name === name);
        if (exist) {
          exist.qty += 1;
        } else {
          simState.items.push({ name, qty: 1, rate, stock });
        }

        // Animate tag
        tag.classList.add("added");
        setTimeout(() => tag.classList.remove("added"), 400);

        renderItems();
        toast("Added " + name + " to bill! Stock deducted.", "ok", 1500);
      };
    });

    // Payment mode toggle
    payPills.forEach((p) => {
      p.onclick = () => {
        payPills.forEach((x) => x.classList.remove("active"));
        p.classList.add("active");
        simState.paymentMode = p.getAttribute("data-mode");
        paidRow.style.display = simState.paymentMode === "partial" ? "flex" : "none";
        renderItems();
      };
    });

    paidInput.oninput = () => {
      simState.paidAmount = Math.max(0, parseFloat(paidInput.value) || 0);
      const subtotal = simState.items.reduce((acc, it) => acc + (it.qty * it.rate), 0);
      const totalDue = simState.prevBalance + subtotal;
      const finalRemaining = totalDue - simState.paidAmount;
      balanceEl.textContent = "Rs. " + finalRemaining.toLocaleString();
      balanceEl.className = finalRemaining > 0 ? "lp-rc-neg" : "lp-rc-pos";
    };

    // Save Bill Sim Action
    container.querySelector("#lp-sim-save-btn").onclick = () => {
      const subtotal = simState.items.reduce((acc, it) => acc + (it.qty * it.rate), 0);
      if (subtotal === 0) {
        toast("Please add at least one item to make a bill!", "err");
        return;
      }
      toast("✓ Bill of Rs. " + subtotal.toLocaleString() + " saved! Stock updated & Udharo recorded.", "ok", 3000);
    };

    // WhatsApp Reminder Modal Preview
    container.querySelector("#lp-sim-wa-btn").onclick = () => {
      const subtotal = simState.items.reduce((acc, it) => acc + (it.qty * it.rate), 0);
      const totalDue = simState.prevBalance + subtotal - simState.paidAmount;
      const msg = `नमस्ते ${simState.customer} ज्यू, तपाईंको Ramesh Kirana Store मा बाँकी उधारो रकम Rs. ${totalDue.toLocaleString()} रहेको छ। कृपया समयमै भुक्तानी गरिदिनुहोला। धन्यवाद!`;

      alert("📲 WhatsApp Message Preview:\n\n" + msg + "\n\n(In the real app, this opens WhatsApp directly with 1 tap!)");
    };

    renderItems();
  },

  /* ---------- ROI / Time Savings Calculator ---------- */
  initCalculator(container) {
    const billsSlider = container.querySelector("#lp-calc-bills");
    const custSlider = container.querySelector("#lp-calc-cust");
    const billsVal = container.querySelector("#lp-calc-bills-val");
    const custVal = container.querySelector("#lp-calc-cust-val");

    const resTime = container.querySelector("#lp-res-time");
    const resUdharo = container.querySelector("#lp-res-udharo");

    const updateCalc = () => {
      const bills = parseInt(billsSlider.value, 10);
      const cust = parseInt(custSlider.value, 10);

      billsVal.textContent = bills + " bills / day";
      custVal.textContent = cust + " customers";

      // Approx 45 seconds saved per bill -> in a month (30 days) = bills * 30 * 45s / 3600
      const hoursSaved = Math.round((bills * 30 * 50) / 3600);
      // Approx Rs. 450 uncollected/forgotten credit saved per active credit customer
      const moneySaved = Math.round(cust * 460);

      resTime.textContent = `~${hoursSaved} Hours`;
      resUdharo.textContent = `Rs. ${moneySaved.toLocaleString()}+`;
    };

    billsSlider.oninput = updateCalc;
    custSlider.oninput = updateCalc;
    updateCalc();
  },

  /* ---------- Workflow Tab Switcher ---------- */
  initTabs(container) {
    const tabs = container.querySelectorAll(".lp-tab-btn");
    const panes = container.querySelectorAll(".lp-tab-pane");

    tabs.forEach((tab) => {
      tab.onclick = () => {
        tabs.forEach((t) => t.classList.remove("active"));
        panes.forEach((p) => p.classList.remove("active"));

        tab.classList.add("active");
        const target = tab.getAttribute("data-tab");
        const pane = container.querySelector("#" + target);
        if (pane) pane.classList.add("active");
      };
    });
  }
};
