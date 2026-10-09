/* Tecmo first-person browser bridge 0.4.2. No ROM included.
 * JSNES: Apache-2.0; roster data: MIT. See THIRD_PARTY_NOTICES.txt and licenses/.
 * Concatenated classic scripts in original dependency order. */

;/* vendor/jsnes/jsnes-tecmo.js */
/* Local modification to JSNES 2.1.0 (Apache-2.0): correct the 8x16 sprite
 * odd-bank top tile lookup from (tile & 0xfe) - 1 + 256 to
 * (tile & 0xfe) + 256. Original distribution is preserved alongside.
 * See THIRD_PARTY_NOTICES.txt and tests/nes-bridge.test.cjs. */
(function webpackUniversalModuleDefinition(root, factory) {
	if(typeof exports === 'object' && typeof module === 'object')
		module.exports = factory();
	else if(typeof define === 'function' && define.amd)
		define("jsnes", [], factory);
	else if(typeof exports === 'object')
		exports["jsnes"] = factory();
	else
		root["jsnes"] = factory();
})(globalThis, () => {
return /******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	// The require scope
/******/ 	var __webpack_require__ = {};
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/define property getters */
/******/ 	(() => {
/******/ 		// define getter functions for harmony exports
/******/ 		__webpack_require__.d = (exports, definition) => {
/******/ 			for(var key in definition) {
/******/ 				if(__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {
/******/ 					Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
/******/ 				}
/******/ 			}
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/hasOwnProperty shorthand */
/******/ 	(() => {
/******/ 		__webpack_require__.o = (obj, prop) => (Object.prototype.hasOwnProperty.call(obj, prop))
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/make namespace object */
/******/ 	(() => {
/******/ 		// define __esModule on exports
/******/ 		__webpack_require__.r = (exports) => {
/******/ 			if(typeof Symbol !== 'undefined' && Symbol.toStringTag) {
/******/ 				Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/******/ 			}
/******/ 			Object.defineProperty(exports, '__esModule', { value: true });
/******/ 		};
/******/ 	})();
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
// ESM COMPAT FLAG
__webpack_require__.r(__webpack_exports__);

// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  Browser: () => (/* reexport */ Browser),
  Controller: () => (/* reexport */ controller),
  GameGenie: () => (/* reexport */ gamegenie),
  NES: () => (/* reexport */ nes)
});

;// ./src/utils.js
function copyArrayElements(src, srcPos, dest, destPos, length) {
  for (let i = 0; i < length; ++i) {
    dest[destPos + i] = src[srcPos + i];
  }
}

function copyArray(src) {
  return src.slice(0);
}

function fromJSON(obj, state) {
  const props = obj.constructor.JSON_PROPERTIES;
  for (let i = 0; i < props.length; i++) {
    const prop = props[i];
    const current = obj[prop];
    const value = state[prop];
    if (ArrayBuffer.isView(current) && Array.isArray(value)) {
      // Typed arrays: copy data in-place instead of replacing the array,
      // since JSON.parse produces plain arrays not typed arrays.
      current.set(value);
    } else {
      obj[prop] = value;
    }
  }
}

function toJSON(obj) {
  const state = {};
  const props = obj.constructor.JSON_PROPERTIES;
  for (let i = 0; i < props.length; i++) {
    const prop = props[i];
    const value = obj[prop];
    // Typed arrays must be converted to plain arrays for JSON.stringify,
    // which otherwise serializes them as objects ({0: v, 1: v, ...}).
    state[prop] = ArrayBuffer.isView(value) ? Array.from(value) : value;
  }
  return state;
}

;// ./src/cpu.js


// ============================================================================
// 6502 opcode table
// ============================================================================
//
// The NES's CPU is a MOS 6502 variant (the Ricoh 2A03 on NTSC consoles,
// 2A07 on PAL). Like any CPU, it runs machine code by repeatedly fetching
// a byte from memory, decoding what that byte means, and executing the
// corresponding operation — the classic fetch-decode-execute loop.
//
// On the 6502, every (operation, addressing mode) pair is assigned its own
// unique 1-byte opcode. For example, "LDA" (Load Accumulator) has eight
// different opcode bytes because it supports eight addressing modes — one
// for "load from a fixed 2-byte address", one for "load from a zero-page
// address + X", and so on. That gives a total of 256 possible opcode bytes,
// of which the official 6502 defines 151; another ~80 are "unofficial"
// opcodes (see below); the rest are unused and would hang a real CPU.
//
// This file's emulate() method implements the fetch-decode-execute loop for
// a single CPU instruction. OPCODE_TABLE is the *decode* step: given the
// opcode byte we just fetched, it tells emulate() everything it needs to
// know before running the instruction:
//
//   ins    - which instruction to execute (INS_*). Used as the switch key
//            in the execute phase of emulate().
//   mode   - which addressing mode to use to find the operand (ADDR_*).
//            Used as the switch key in the addressing phase of emulate().
//   size   - how many bytes the instruction occupies in memory (1-3),
//            so emulate() knows how far to advance the program counter.
//   cycles - base cycle count. Some instructions pay an extra cycle when
//            an indexed addressing mode crosses a 256-byte "page" boundary
//            (since the 6502 has to do an extra bus cycle to correct the
//            high byte of the address), and the execute switch adds that
//            extra cycle where appropriate.
//
// OPCODE_TABLE is defined as a plain object literal below, keyed by the
// raw opcode byte (0-255). Unassigned bytes are simply absent; at dispatch
// time the lookup returns `undefined`, which is then replaced with a
// shared INVALID_OPCODE sentinel so that invalid opcodes fall through to
// the execute switch's default case and throw.
//
// The INS_* and ADDR_* numeric values here must match the `case N:` labels
// in the two switches in emulate(). If you ever renumber these, update
// both switches in lockstep.

// ----------------------------------------------------------------------------
// Addressing modes
// ----------------------------------------------------------------------------
//
// The 6502 has 13 addressing modes — different ways of specifying where an
// instruction's operand lives. Some modes take a literal value, some read
// from a fixed memory address, some compute an address from a base plus an
// index register (X or Y), and some dereference a pointer stored in memory.
//
// The numeric values here are used as `case` labels in the addressing-mode
// switch at the top of emulate(), which computes the final effective
// address (or loads the literal value) for each instruction before the
// instruction itself runs. The code in that switch is the authoritative
// source for what each mode actually does on the bus, including the
// sometimes-tricky "dummy reads" the real 6502 performs on indexed modes.
//
// Notation below: $XX means a 1-byte value (0-$FF), $XXXX means a 2-byte
// value (0-$FFFF). "Zero page" is the first 256 bytes of memory ($0000-
// $00FF), which the 6502 can address with a single byte — giving faster
// and smaller code than full 16-bit addresses.
//
// See https://www.nesdev.org/wiki/CPU_addressing_modes

const ADDR_ZP = 0; //          Zero page         — operand at $00XX
const ADDR_REL = 1; //         Relative          — PC + signed 8-bit offset (branches)
const ADDR_IMP = 2; //         Implied           — no operand (e.g. CLC, RTS, TAX)
const ADDR_ABS = 3; //         Absolute          — operand at $XXXX (any address)
const ADDR_ACC = 4; //         Accumulator       — operand is the A register itself
const ADDR_IMM = 5; //         Immediate         — operand is a literal byte (LDA #$42)
const ADDR_ZPX = 6; //         Zero page,X       — operand at ($XX + X) & $FF
const ADDR_ZPY = 7; //         Zero page,Y       — operand at ($XX + Y) & $FF
const ADDR_ABSX = 8; //        Absolute,X        — operand at $XXXX + X
const ADDR_ABSY = 9; //        Absolute,Y        — operand at $XXXX + Y
const ADDR_PREIDXIND = 10; //  (Indirect,X)      — pointer at ($XX + X) in zero page
const ADDR_POSTIDXIND = 11; // (Indirect),Y      — pointer at $XX in zero page, then + Y
const ADDR_INDABS = 12; //     Indirect absolute — pointer at $XXXX (JMP indirect only)

// ----------------------------------------------------------------------------
// Instructions
// ----------------------------------------------------------------------------
//
// The 6502 has 56 official instructions, each conventionally referred to
// by a 3-letter mnemonic (LDA, STA, JMP, etc.). Most instructions support
// several addressing modes, so one mnemonic usually maps to several opcode
// bytes — which is why OPCODE_TABLE below has multiple entries per
// mnemonic (e.g. LDA has eight, one for each addressing mode it supports).
//
// Each INS_* here is an internal identifier used as the `case` label in
// the execute switch in emulate(). The ordering and numeric values are
// arbitrary but must stay in sync with that switch.
//
// NOTE: the NES's 2A03/2A07 CPU omits the 6502's BCD (binary-coded decimal)
// mode. The CLD / SED instructions still exist and toggle the D flag, but
// the D flag has no effect on ADC/SBC. That's why the CLD/SED handlers in
// emulate() look like no-ops aside from flipping the flag.
//
// See https://www.nesdev.org/wiki/CPU for a per-instruction reference.

// Arithmetic & logic
const INS_ADC = 0; //  ADC — Add memory to accumulator with carry
const INS_AND = 1; //  AND — Bitwise AND memory with accumulator
const INS_ASL = 2; //  ASL — Arithmetic shift left (top bit → carry)
// Branches — each tests one status flag and jumps relative to PC if it matches
const INS_BCC = 3; //  BCC — Branch if carry clear
const INS_BCS = 4; //  BCS — Branch if carry set
const INS_BEQ = 5; //  BEQ — Branch if equal (zero flag set)
const INS_BIT = 6; //  BIT — Bit test: N ← M.7, V ← M.6, Z ← (A & M) == 0
const INS_BMI = 7; //  BMI — Branch if minus (negative flag set)
const INS_BNE = 8; //  BNE — Branch if not equal (zero flag clear)
const INS_BPL = 9; //  BPL — Branch if plus (negative flag clear)
const INS_BRK = 10; // BRK — Software interrupt (pushes PC+2 and status, jumps via $FFFE)
const INS_BVC = 11; // BVC — Branch if overflow clear
const INS_BVS = 12; // BVS — Branch if overflow set
// Flag clears
const INS_CLC = 13; // CLC — Clear carry flag
const INS_CLD = 14; // CLD — Clear decimal flag (no effect on NES, see note above)
const INS_CLI = 15; // CLI — Clear interrupt disable flag
const INS_CLV = 16; // CLV — Clear overflow flag
// Compares — like subtract, but only set flags (don't modify the register)
const INS_CMP = 17; // CMP — Compare memory with accumulator
const INS_CPX = 18; // CPX — Compare memory with X
const INS_CPY = 19; // CPY — Compare memory with Y
// Decrements
const INS_DEC = 20; // DEC — Decrement memory by one
const INS_DEX = 21; // DEX — Decrement X by one
const INS_DEY = 22; // DEY — Decrement Y by one
// XOR
const INS_EOR = 23; // EOR — Bitwise exclusive-OR memory with accumulator
// Increments
const INS_INC = 24; // INC — Increment memory by one
const INS_INX = 25; // INX — Increment X by one
const INS_INY = 26; // INY — Increment Y by one
// Jumps
const INS_JMP = 27; // JMP — Unconditional jump
const INS_JSR = 28; // JSR — Jump to subroutine (pushes return address first)
// Loads
const INS_LDA = 29; // LDA — Load accumulator from memory
const INS_LDX = 30; // LDX — Load X from memory
const INS_LDY = 31; // LDY — Load Y from memory
// Shift
const INS_LSR = 32; // LSR — Logical shift right (bottom bit → carry)
// No-op
const INS_NOP = 33; // NOP — No operation
// OR
const INS_ORA = 34; // ORA — Bitwise OR memory with accumulator
// Stack pushes/pulls ("pull" is the 6502 term for "pop")
const INS_PHA = 35; // PHA — Push accumulator onto stack
const INS_PHP = 36; // PHP — Push processor status onto stack
const INS_PLA = 37; // PLA — Pull accumulator from stack
const INS_PLP = 38; // PLP — Pull processor status from stack
// Rotates (through carry)
const INS_ROL = 39; // ROL — Rotate left through carry (C → bit 0, bit 7 → C)
const INS_ROR = 40; // ROR — Rotate right through carry (C → bit 7, bit 0 → C)
// Returns
const INS_RTI = 41; // RTI — Return from interrupt (pulls status and PC)
const INS_RTS = 42; // RTS — Return from subroutine (pulls PC)
// Subtract
const INS_SBC = 43; // SBC — Subtract memory from accumulator with borrow
// Flag sets
const INS_SEC = 44; // SEC — Set carry flag
const INS_SED = 45; // SED — Set decimal flag (no effect on NES, see note above)
const INS_SEI = 46; // SEI — Set interrupt disable flag
// Stores
const INS_STA = 47; // STA — Store accumulator to memory
const INS_STX = 48; // STX — Store X to memory
const INS_STY = 49; // STY — Store Y to memory
// Register transfers
const INS_TAX = 50; // TAX — Transfer accumulator to X
const INS_TAY = 51; // TAY — Transfer accumulator to Y
const INS_TSX = 52; // TSX — Transfer stack pointer to X
const INS_TXA = 53; // TXA — Transfer X to accumulator
const INS_TXS = 54; // TXS — Transfer X to stack pointer
const INS_TYA = 55; // TYA — Transfer Y to accumulator

// ----------------------------------------------------------------------------
// Unofficial opcodes
// ----------------------------------------------------------------------------
//
// The 6502's instruction decoder is a combinational circuit rather than a
// lookup table, and about 80 of the 256 possible opcode bytes decode to
// instructions that weren't part of the official instruction set but still
// do *something* — usually a combination of two official instructions that
// happen to share hardware (e.g. SLO = "ASL then ORA"). Some shipped NES
// games, and most CPU test ROMs (including nestest and AccuracyCoin), use
// them deliberately, so a correct NES emulator has to implement them.
//
// See https://www.nesdev.org/wiki/Programming_with_unofficial_opcodes

// Combined arithmetic/logic on the accumulator (immediate operand only)
const INS_ALR = 56; // ALR (ASR) — AND then LSR:  A = (A & #imm) >> 1
const INS_ANC = 57; // ANC        — AND, but also copy result's bit 7 into carry
const INS_ARR = 58; // ARR        — AND then ROR, with peculiar N/V/C side effects
const INS_AXS = 59; // AXS (SBX)  — X = (A & X) - #imm (like CMP, but stores result)
// Combined load/store
const INS_LAX = 60; // LAX — Load A and X from memory simultaneously
const INS_SAX = 61; // SAX — Store (A & X) to memory
// Read-modify-write combos: each does an RMW on memory then an A-side op
const INS_DCP = 62; // DCP — DEC memory then CMP with A
const INS_ISC = 63; // ISC (ISB) — INC memory then SBC from A
const INS_RLA = 64; // RLA — ROL memory then AND with A
const INS_RRA = 65; // RRA — ROR memory then ADC with A
const INS_SLO = 66; // SLO — ASL memory then ORA with A
const INS_SRE = 67; // SRE — LSR memory then EOR with A
// Multi-byte NOPs. These consume extra bytes and (for IGN) still perform a
// dummy memory read, but don't otherwise affect state. Games occasionally
// use them for precise cycle-count padding.
const INS_SKB = 68; // SKB — 2-byte NOP (skips an immediate byte)
const INS_IGN = 69; // IGN — 3-byte NOP that still reads from memory

// "Unstable" opcodes whose output depends on the internal bus arbitration
// between CPU cycles. Most store (register & (high byte of target + 1)).
// The DMC audio channel's DMA transfer can hijack the bus mid-instruction
// and change the stored value — the emulator handles this interaction in
// the execute switch. Essentially no shipped games use these, but the
// AccuracyCoin test ROM does.
const INS_SHA = 71; // SHA (AHX) — Store A & X & (H+1)
const INS_SHS = 72; // SHS (TAS) — SP = A & X, then store SP & (H+1)
const INS_SHY = 73; // SHY (SYA) — Store Y & (H+1)
const INS_SHX = 74; // SHX (SXA) — Store X & (H+1)
const INS_LAE = 75; // LAE (LAS) — A = X = SP = (memory & SP)

// Opcodes whose behavior depends on a "magic" constant that varies between
// CPU manufacturing runs (and even across die temperature). Tests only
// exercise these with inputs (A = $FF, or immediate = $00) where the magic
// value cancels out of the result, so we can pick any reasonable magic.
const INS_ANE = 76; // ANE (XAA) — A = (A | magic) & X & #imm
const INS_LXA = 77; // LXA (ATX) — A = X = (A | magic) & #imm

// ----------------------------------------------------------------------------
// The opcode table
// ----------------------------------------------------------------------------
//
// OPCODE_TABLE is a plain object keyed by opcode byte. Every valid 6502
// opcode has an entry here; unassigned bytes (including the KIL/STP/JAM
// family that would hang a real CPU) are simply absent from the table.
// The dispatch site in emulate() substitutes INVALID_OPCODE on lookup
// miss, which has `ins: -1` — a value that matches no case in the
// execute switch, so dispatch falls through to the default case and
// throws a clear "invalid opcode" error.
//
// Using a shared INVALID_OPCODE object (rather than creating a fresh
// one per lookup miss) means V8 sees a stable hidden class for both
// valid and invalid lookups, which helps the JIT generate faster code
// for the dispatch.
//
// Size and cycle counts come from the official 6502 datasheet and match
// the nesdev wiki's tables at https://www.nesdev.org/wiki/CPU.
//
// The whole OPCODE_TABLE literal is marked `// prettier-ignore` so that
// prettier doesn't collapse the manual column alignment below — being
// able to scan straight down the "mode" column makes the table much
// more readable than the default formatting would allow.

const INVALID_OPCODE = { ins: -1, mode: 0, size: 1, cycles: 2 };

// prettier-ignore
const OPCODE_TABLE = {
  // ADC — Add with carry
  0x69: { ins: INS_ADC, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0x65: { ins: INS_ADC, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0x75: { ins: INS_ADC, mode: ADDR_ZPX,        size: 2, cycles: 4 },
  0x6d: { ins: INS_ADC, mode: ADDR_ABS,        size: 3, cycles: 4 },
  0x7d: { ins: INS_ADC, mode: ADDR_ABSX,       size: 3, cycles: 4 },
  0x79: { ins: INS_ADC, mode: ADDR_ABSY,       size: 3, cycles: 4 },
  0x61: { ins: INS_ADC, mode: ADDR_PREIDXIND,  size: 2, cycles: 6 },
  0x71: { ins: INS_ADC, mode: ADDR_POSTIDXIND, size: 2, cycles: 5 },

  // AND — Bitwise AND with accumulator
  0x29: { ins: INS_AND, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0x25: { ins: INS_AND, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0x35: { ins: INS_AND, mode: ADDR_ZPX,        size: 2, cycles: 4 },
  0x2d: { ins: INS_AND, mode: ADDR_ABS,        size: 3, cycles: 4 },
  0x3d: { ins: INS_AND, mode: ADDR_ABSX,       size: 3, cycles: 4 },
  0x39: { ins: INS_AND, mode: ADDR_ABSY,       size: 3, cycles: 4 },
  0x21: { ins: INS_AND, mode: ADDR_PREIDXIND,  size: 2, cycles: 6 },
  0x31: { ins: INS_AND, mode: ADDR_POSTIDXIND, size: 2, cycles: 5 },

  // ASL — Arithmetic shift left
  0x0a: { ins: INS_ASL, mode: ADDR_ACC,        size: 1, cycles: 2 },
  0x06: { ins: INS_ASL, mode: ADDR_ZP,         size: 2, cycles: 5 },
  0x16: { ins: INS_ASL, mode: ADDR_ZPX,        size: 2, cycles: 6 },
  0x0e: { ins: INS_ASL, mode: ADDR_ABS,        size: 3, cycles: 6 },
  0x1e: { ins: INS_ASL, mode: ADDR_ABSX,       size: 3, cycles: 7 },

  // Branches — each tests a status flag and jumps relative to PC if it matches
  0x90: { ins: INS_BCC, mode: ADDR_REL,        size: 2, cycles: 2 },
  0xb0: { ins: INS_BCS, mode: ADDR_REL,        size: 2, cycles: 2 },
  0xf0: { ins: INS_BEQ, mode: ADDR_REL,        size: 2, cycles: 2 },
  0x30: { ins: INS_BMI, mode: ADDR_REL,        size: 2, cycles: 2 },
  0xd0: { ins: INS_BNE, mode: ADDR_REL,        size: 2, cycles: 2 },
  0x10: { ins: INS_BPL, mode: ADDR_REL,        size: 2, cycles: 2 },
  0x50: { ins: INS_BVC, mode: ADDR_REL,        size: 2, cycles: 2 },
  0x70: { ins: INS_BVS, mode: ADDR_REL,        size: 2, cycles: 2 },

  // BIT — Test bits in memory against accumulator
  0x24: { ins: INS_BIT, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0x2c: { ins: INS_BIT, mode: ADDR_ABS,        size: 3, cycles: 4 },

  // BRK — Software interrupt
  0x00: { ins: INS_BRK, mode: ADDR_IMP,        size: 1, cycles: 7 },

  // Flag clears
  0x18: { ins: INS_CLC, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0xd8: { ins: INS_CLD, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0x58: { ins: INS_CLI, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0xb8: { ins: INS_CLV, mode: ADDR_IMP,        size: 1, cycles: 2 },

  // CMP — Compare memory with accumulator (sets flags only)
  0xc9: { ins: INS_CMP, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0xc5: { ins: INS_CMP, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0xd5: { ins: INS_CMP, mode: ADDR_ZPX,        size: 2, cycles: 4 },
  0xcd: { ins: INS_CMP, mode: ADDR_ABS,        size: 3, cycles: 4 },
  0xdd: { ins: INS_CMP, mode: ADDR_ABSX,       size: 3, cycles: 4 },
  0xd9: { ins: INS_CMP, mode: ADDR_ABSY,       size: 3, cycles: 4 },
  0xc1: { ins: INS_CMP, mode: ADDR_PREIDXIND,  size: 2, cycles: 6 },
  0xd1: { ins: INS_CMP, mode: ADDR_POSTIDXIND, size: 2, cycles: 5 },

  // CPX — Compare memory with X
  0xe0: { ins: INS_CPX, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0xe4: { ins: INS_CPX, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0xec: { ins: INS_CPX, mode: ADDR_ABS,        size: 3, cycles: 4 },

  // CPY — Compare memory with Y
  0xc0: { ins: INS_CPY, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0xc4: { ins: INS_CPY, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0xcc: { ins: INS_CPY, mode: ADDR_ABS,        size: 3, cycles: 4 },

  // DEC — Decrement memory by one
  0xc6: { ins: INS_DEC, mode: ADDR_ZP,         size: 2, cycles: 5 },
  0xd6: { ins: INS_DEC, mode: ADDR_ZPX,        size: 2, cycles: 6 },
  0xce: { ins: INS_DEC, mode: ADDR_ABS,        size: 3, cycles: 6 },
  0xde: { ins: INS_DEC, mode: ADDR_ABSX,       size: 3, cycles: 7 },

  // DEX / DEY — Decrement X / Y by one
  0xca: { ins: INS_DEX, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0x88: { ins: INS_DEY, mode: ADDR_IMP,        size: 1, cycles: 2 },

  // EOR — Bitwise exclusive-OR with accumulator
  0x49: { ins: INS_EOR, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0x45: { ins: INS_EOR, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0x55: { ins: INS_EOR, mode: ADDR_ZPX,        size: 2, cycles: 4 },
  0x4d: { ins: INS_EOR, mode: ADDR_ABS,        size: 3, cycles: 4 },
  0x5d: { ins: INS_EOR, mode: ADDR_ABSX,       size: 3, cycles: 4 },
  0x59: { ins: INS_EOR, mode: ADDR_ABSY,       size: 3, cycles: 4 },
  0x41: { ins: INS_EOR, mode: ADDR_PREIDXIND,  size: 2, cycles: 6 },
  0x51: { ins: INS_EOR, mode: ADDR_POSTIDXIND, size: 2, cycles: 5 },

  // INC — Increment memory by one
  0xe6: { ins: INS_INC, mode: ADDR_ZP,         size: 2, cycles: 5 },
  0xf6: { ins: INS_INC, mode: ADDR_ZPX,        size: 2, cycles: 6 },
  0xee: { ins: INS_INC, mode: ADDR_ABS,        size: 3, cycles: 6 },
  0xfe: { ins: INS_INC, mode: ADDR_ABSX,       size: 3, cycles: 7 },

  // INX / INY — Increment X / Y by one
  0xe8: { ins: INS_INX, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0xc8: { ins: INS_INY, mode: ADDR_IMP,        size: 1, cycles: 2 },

  // JMP — Unconditional jump (absolute or via indirect pointer)
  0x4c: { ins: INS_JMP, mode: ADDR_ABS,        size: 3, cycles: 3 },
  0x6c: { ins: INS_JMP, mode: ADDR_INDABS,     size: 3, cycles: 5 },

  // JSR — Jump to subroutine (pushes return address first)
  0x20: { ins: INS_JSR, mode: ADDR_ABS,        size: 3, cycles: 6 },

  // LDA — Load accumulator from memory
  0xa9: { ins: INS_LDA, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0xa5: { ins: INS_LDA, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0xb5: { ins: INS_LDA, mode: ADDR_ZPX,        size: 2, cycles: 4 },
  0xad: { ins: INS_LDA, mode: ADDR_ABS,        size: 3, cycles: 4 },
  0xbd: { ins: INS_LDA, mode: ADDR_ABSX,       size: 3, cycles: 4 },
  0xb9: { ins: INS_LDA, mode: ADDR_ABSY,       size: 3, cycles: 4 },
  0xa1: { ins: INS_LDA, mode: ADDR_PREIDXIND,  size: 2, cycles: 6 },
  0xb1: { ins: INS_LDA, mode: ADDR_POSTIDXIND, size: 2, cycles: 5 },

  // LDX — Load X from memory
  0xa2: { ins: INS_LDX, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0xa6: { ins: INS_LDX, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0xb6: { ins: INS_LDX, mode: ADDR_ZPY,        size: 2, cycles: 4 },
  0xae: { ins: INS_LDX, mode: ADDR_ABS,        size: 3, cycles: 4 },
  0xbe: { ins: INS_LDX, mode: ADDR_ABSY,       size: 3, cycles: 4 },

  // LDY — Load Y from memory
  0xa0: { ins: INS_LDY, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0xa4: { ins: INS_LDY, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0xb4: { ins: INS_LDY, mode: ADDR_ZPX,        size: 2, cycles: 4 },
  0xac: { ins: INS_LDY, mode: ADDR_ABS,        size: 3, cycles: 4 },
  0xbc: { ins: INS_LDY, mode: ADDR_ABSX,       size: 3, cycles: 4 },

  // LSR — Logical shift right
  0x4a: { ins: INS_LSR, mode: ADDR_ACC,        size: 1, cycles: 2 },
  0x46: { ins: INS_LSR, mode: ADDR_ZP,         size: 2, cycles: 5 },
  0x56: { ins: INS_LSR, mode: ADDR_ZPX,        size: 2, cycles: 6 },
  0x4e: { ins: INS_LSR, mode: ADDR_ABS,        size: 3, cycles: 6 },
  0x5e: { ins: INS_LSR, mode: ADDR_ABSX,       size: 3, cycles: 7 },

  // NOP — No operation. $EA is the official NOP; the other six bytes are
  // unofficial single-byte NOPs that the 6502's decoder happens to treat
  // identically, and we handle them the same way.
  0x1a: { ins: INS_NOP, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0x3a: { ins: INS_NOP, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0x5a: { ins: INS_NOP, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0x7a: { ins: INS_NOP, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0xda: { ins: INS_NOP, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0xea: { ins: INS_NOP, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0xfa: { ins: INS_NOP, mode: ADDR_IMP,        size: 1, cycles: 2 },

  // ORA — Bitwise OR with accumulator
  0x09: { ins: INS_ORA, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0x05: { ins: INS_ORA, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0x15: { ins: INS_ORA, mode: ADDR_ZPX,        size: 2, cycles: 4 },
  0x0d: { ins: INS_ORA, mode: ADDR_ABS,        size: 3, cycles: 4 },
  0x1d: { ins: INS_ORA, mode: ADDR_ABSX,       size: 3, cycles: 4 },
  0x19: { ins: INS_ORA, mode: ADDR_ABSY,       size: 3, cycles: 4 },
  0x01: { ins: INS_ORA, mode: ADDR_PREIDXIND,  size: 2, cycles: 6 },
  0x11: { ins: INS_ORA, mode: ADDR_POSTIDXIND, size: 2, cycles: 5 },

  // Stack pushes/pulls — PHA/PLA move the accumulator, PHP/PLP the status
  // register. The 6502 stack lives in page 1 ($0100-$01FF), with SP as an
  // offset into that page.
  0x48: { ins: INS_PHA, mode: ADDR_IMP,        size: 1, cycles: 3 },
  0x08: { ins: INS_PHP, mode: ADDR_IMP,        size: 1, cycles: 3 },
  0x68: { ins: INS_PLA, mode: ADDR_IMP,        size: 1, cycles: 4 },
  0x28: { ins: INS_PLP, mode: ADDR_IMP,        size: 1, cycles: 4 },

  // ROL — Rotate left through carry
  0x2a: { ins: INS_ROL, mode: ADDR_ACC,        size: 1, cycles: 2 },
  0x26: { ins: INS_ROL, mode: ADDR_ZP,         size: 2, cycles: 5 },
  0x36: { ins: INS_ROL, mode: ADDR_ZPX,        size: 2, cycles: 6 },
  0x2e: { ins: INS_ROL, mode: ADDR_ABS,        size: 3, cycles: 6 },
  0x3e: { ins: INS_ROL, mode: ADDR_ABSX,       size: 3, cycles: 7 },

  // ROR — Rotate right through carry
  0x6a: { ins: INS_ROR, mode: ADDR_ACC,        size: 1, cycles: 2 },
  0x66: { ins: INS_ROR, mode: ADDR_ZP,         size: 2, cycles: 5 },
  0x76: { ins: INS_ROR, mode: ADDR_ZPX,        size: 2, cycles: 6 },
  0x6e: { ins: INS_ROR, mode: ADDR_ABS,        size: 3, cycles: 6 },
  0x7e: { ins: INS_ROR, mode: ADDR_ABSX,       size: 3, cycles: 7 },

  // RTI / RTS — Return from interrupt handler / subroutine
  0x40: { ins: INS_RTI, mode: ADDR_IMP,        size: 1, cycles: 6 },
  0x60: { ins: INS_RTS, mode: ADDR_IMP,        size: 1, cycles: 6 },

  // SBC — Subtract memory from accumulator with borrow.
  // $EB is an unofficial alternate opcode that the 6502's decoder treats
  // identically to the official $E9 (immediate SBC).
  0xe9: { ins: INS_SBC, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0xeb: { ins: INS_SBC, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0xe5: { ins: INS_SBC, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0xf5: { ins: INS_SBC, mode: ADDR_ZPX,        size: 2, cycles: 4 },
  0xed: { ins: INS_SBC, mode: ADDR_ABS,        size: 3, cycles: 4 },
  0xfd: { ins: INS_SBC, mode: ADDR_ABSX,       size: 3, cycles: 4 },
  0xf9: { ins: INS_SBC, mode: ADDR_ABSY,       size: 3, cycles: 4 },
  0xe1: { ins: INS_SBC, mode: ADDR_PREIDXIND,  size: 2, cycles: 6 },
  0xf1: { ins: INS_SBC, mode: ADDR_POSTIDXIND, size: 2, cycles: 5 },

  // Flag sets
  0x38: { ins: INS_SEC, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0xf8: { ins: INS_SED, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0x78: { ins: INS_SEI, mode: ADDR_IMP,        size: 1, cycles: 2 },

  // STA — Store accumulator to memory
  0x85: { ins: INS_STA, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0x95: { ins: INS_STA, mode: ADDR_ZPX,        size: 2, cycles: 4 },
  0x8d: { ins: INS_STA, mode: ADDR_ABS,        size: 3, cycles: 4 },
  0x9d: { ins: INS_STA, mode: ADDR_ABSX,       size: 3, cycles: 5 },
  0x99: { ins: INS_STA, mode: ADDR_ABSY,       size: 3, cycles: 5 },
  0x81: { ins: INS_STA, mode: ADDR_PREIDXIND,  size: 2, cycles: 6 },
  0x91: { ins: INS_STA, mode: ADDR_POSTIDXIND, size: 2, cycles: 6 },

  // STX — Store X to memory
  0x86: { ins: INS_STX, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0x96: { ins: INS_STX, mode: ADDR_ZPY,        size: 2, cycles: 4 },
  0x8e: { ins: INS_STX, mode: ADDR_ABS,        size: 3, cycles: 4 },

  // STY — Store Y to memory
  0x84: { ins: INS_STY, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0x94: { ins: INS_STY, mode: ADDR_ZPX,        size: 2, cycles: 4 },
  0x8c: { ins: INS_STY, mode: ADDR_ABS,        size: 3, cycles: 4 },

  // Register transfers — copy one register to another in a single cycle
  0xaa: { ins: INS_TAX, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0xa8: { ins: INS_TAY, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0xba: { ins: INS_TSX, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0x8a: { ins: INS_TXA, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0x9a: { ins: INS_TXS, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0x98: { ins: INS_TYA, mode: ADDR_IMP,        size: 1, cycles: 2 },

  // --- Unofficial opcodes ---
  //
  // These aren't part of the official 6502 spec but fall out of the chip's
  // decoder logic. Nestest and AccuracyCoin exercise them, and a handful
  // of shipped NES games rely on them. See the INS_* comments above for
  // what each one actually computes.

  // ALR (ASR) — AND then LSR
  0x4b: { ins: INS_ALR, mode: ADDR_IMM,        size: 2, cycles: 2 },

  // ANC — AND, with carry also set to bit 7 of the result
  0x0b: { ins: INS_ANC, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0x2b: { ins: INS_ANC, mode: ADDR_IMM,        size: 2, cycles: 2 },

  // ARR — AND then ROR (with quirky N/V/C flag behavior)
  0x6b: { ins: INS_ARR, mode: ADDR_IMM,        size: 2, cycles: 2 },

  // AXS (SBX) — X = (A & X) - immediate
  0xcb: { ins: INS_AXS, mode: ADDR_IMM,        size: 2, cycles: 2 },

  // LAX — Load A and X simultaneously from memory
  0xa3: { ins: INS_LAX, mode: ADDR_PREIDXIND,  size: 2, cycles: 6 },
  0xa7: { ins: INS_LAX, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0xaf: { ins: INS_LAX, mode: ADDR_ABS,        size: 3, cycles: 4 },
  0xb3: { ins: INS_LAX, mode: ADDR_POSTIDXIND, size: 2, cycles: 5 },
  0xb7: { ins: INS_LAX, mode: ADDR_ZPY,        size: 2, cycles: 4 },
  0xbf: { ins: INS_LAX, mode: ADDR_ABSY,       size: 3, cycles: 4 },

  // SAX — Store (A & X) to memory
  0x83: { ins: INS_SAX, mode: ADDR_PREIDXIND,  size: 2, cycles: 6 },
  0x87: { ins: INS_SAX, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0x8f: { ins: INS_SAX, mode: ADDR_ABS,        size: 3, cycles: 4 },
  0x97: { ins: INS_SAX, mode: ADDR_ZPY,        size: 2, cycles: 4 },

  // DCP — DEC memory then CMP with A
  0xc3: { ins: INS_DCP, mode: ADDR_PREIDXIND,  size: 2, cycles: 8 },
  0xc7: { ins: INS_DCP, mode: ADDR_ZP,         size: 2, cycles: 5 },
  0xcf: { ins: INS_DCP, mode: ADDR_ABS,        size: 3, cycles: 6 },
  0xd3: { ins: INS_DCP, mode: ADDR_POSTIDXIND, size: 2, cycles: 8 },
  0xd7: { ins: INS_DCP, mode: ADDR_ZPX,        size: 2, cycles: 6 },
  0xdb: { ins: INS_DCP, mode: ADDR_ABSY,       size: 3, cycles: 7 },
  0xdf: { ins: INS_DCP, mode: ADDR_ABSX,       size: 3, cycles: 7 },

  // ISC (ISB) — INC memory then SBC from A
  0xe3: { ins: INS_ISC, mode: ADDR_PREIDXIND,  size: 2, cycles: 8 },
  0xe7: { ins: INS_ISC, mode: ADDR_ZP,         size: 2, cycles: 5 },
  0xef: { ins: INS_ISC, mode: ADDR_ABS,        size: 3, cycles: 6 },
  0xf3: { ins: INS_ISC, mode: ADDR_POSTIDXIND, size: 2, cycles: 8 },
  0xf7: { ins: INS_ISC, mode: ADDR_ZPX,        size: 2, cycles: 6 },
  0xfb: { ins: INS_ISC, mode: ADDR_ABSY,       size: 3, cycles: 7 },
  0xff: { ins: INS_ISC, mode: ADDR_ABSX,       size: 3, cycles: 7 },

  // RLA — ROL memory then AND with A
  0x23: { ins: INS_RLA, mode: ADDR_PREIDXIND,  size: 2, cycles: 8 },
  0x27: { ins: INS_RLA, mode: ADDR_ZP,         size: 2, cycles: 5 },
  0x2f: { ins: INS_RLA, mode: ADDR_ABS,        size: 3, cycles: 6 },
  0x33: { ins: INS_RLA, mode: ADDR_POSTIDXIND, size: 2, cycles: 8 },
  0x37: { ins: INS_RLA, mode: ADDR_ZPX,        size: 2, cycles: 6 },
  0x3b: { ins: INS_RLA, mode: ADDR_ABSY,       size: 3, cycles: 7 },
  0x3f: { ins: INS_RLA, mode: ADDR_ABSX,       size: 3, cycles: 7 },

  // RRA — ROR memory then ADC with A
  0x63: { ins: INS_RRA, mode: ADDR_PREIDXIND,  size: 2, cycles: 8 },
  0x67: { ins: INS_RRA, mode: ADDR_ZP,         size: 2, cycles: 5 },
  0x6f: { ins: INS_RRA, mode: ADDR_ABS,        size: 3, cycles: 6 },
  0x73: { ins: INS_RRA, mode: ADDR_POSTIDXIND, size: 2, cycles: 8 },
  0x77: { ins: INS_RRA, mode: ADDR_ZPX,        size: 2, cycles: 6 },
  0x7b: { ins: INS_RRA, mode: ADDR_ABSY,       size: 3, cycles: 7 },
  0x7f: { ins: INS_RRA, mode: ADDR_ABSX,       size: 3, cycles: 7 },

  // SLO — ASL memory then ORA with A
  0x03: { ins: INS_SLO, mode: ADDR_PREIDXIND,  size: 2, cycles: 8 },
  0x07: { ins: INS_SLO, mode: ADDR_ZP,         size: 2, cycles: 5 },
  0x0f: { ins: INS_SLO, mode: ADDR_ABS,        size: 3, cycles: 6 },
  0x13: { ins: INS_SLO, mode: ADDR_POSTIDXIND, size: 2, cycles: 8 },
  0x17: { ins: INS_SLO, mode: ADDR_ZPX,        size: 2, cycles: 6 },
  0x1b: { ins: INS_SLO, mode: ADDR_ABSY,       size: 3, cycles: 7 },
  0x1f: { ins: INS_SLO, mode: ADDR_ABSX,       size: 3, cycles: 7 },

  // SRE — LSR memory then EOR with A
  0x43: { ins: INS_SRE, mode: ADDR_PREIDXIND,  size: 2, cycles: 8 },
  0x47: { ins: INS_SRE, mode: ADDR_ZP,         size: 2, cycles: 5 },
  0x4f: { ins: INS_SRE, mode: ADDR_ABS,        size: 3, cycles: 6 },
  0x53: { ins: INS_SRE, mode: ADDR_POSTIDXIND, size: 2, cycles: 8 },
  0x57: { ins: INS_SRE, mode: ADDR_ZPX,        size: 2, cycles: 6 },
  0x5b: { ins: INS_SRE, mode: ADDR_ABSY,       size: 3, cycles: 7 },
  0x5f: { ins: INS_SRE, mode: ADDR_ABSX,       size: 3, cycles: 7 },

  // SKB — 2-byte NOP that skips an immediate byte
  0x80: { ins: INS_SKB, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0x82: { ins: INS_SKB, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0x89: { ins: INS_SKB, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0xc2: { ins: INS_SKB, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0xe2: { ins: INS_SKB, mode: ADDR_IMM,        size: 2, cycles: 2 },

  // IGN — 3-byte NOP that still performs a memory read
  0x0c: { ins: INS_IGN, mode: ADDR_ABS,        size: 3, cycles: 4 },
  0x1c: { ins: INS_IGN, mode: ADDR_ABSX,       size: 3, cycles: 4 },
  0x3c: { ins: INS_IGN, mode: ADDR_ABSX,       size: 3, cycles: 4 },
  0x5c: { ins: INS_IGN, mode: ADDR_ABSX,       size: 3, cycles: 4 },
  0x7c: { ins: INS_IGN, mode: ADDR_ABSX,       size: 3, cycles: 4 },
  0xdc: { ins: INS_IGN, mode: ADDR_ABSX,       size: 3, cycles: 4 },
  0xfc: { ins: INS_IGN, mode: ADDR_ABSX,       size: 3, cycles: 4 },
  0x04: { ins: INS_IGN, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0x44: { ins: INS_IGN, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0x64: { ins: INS_IGN, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0x14: { ins: INS_IGN, mode: ADDR_ZPX,        size: 2, cycles: 4 },
  0x34: { ins: INS_IGN, mode: ADDR_ZPX,        size: 2, cycles: 4 },
  0x54: { ins: INS_IGN, mode: ADDR_ZPX,        size: 2, cycles: 4 },
  0x74: { ins: INS_IGN, mode: ADDR_ZPX,        size: 2, cycles: 4 },
  0xd4: { ins: INS_IGN, mode: ADDR_ZPX,        size: 2, cycles: 4 },
  0xf4: { ins: INS_IGN, mode: ADDR_ZPX,        size: 2, cycles: 4 },

  // SHA (AHX) — Store A & X & (H+1)
  0x93: { ins: INS_SHA, mode: ADDR_POSTIDXIND, size: 2, cycles: 6 },
  0x9f: { ins: INS_SHA, mode: ADDR_ABSY,       size: 3, cycles: 5 },

  // SHS (TAS) — SP = A & X, then store SP & (H+1)
  0x9b: { ins: INS_SHS, mode: ADDR_ABSY,       size: 3, cycles: 5 },

  // SHY (SYA) — Store Y & (H+1)
  0x9c: { ins: INS_SHY, mode: ADDR_ABSX,       size: 3, cycles: 5 },

  // SHX (SXA) — Store X & (H+1)
  0x9e: { ins: INS_SHX, mode: ADDR_ABSY,       size: 3, cycles: 5 },

  // LAE (LAS) — A = X = SP = memory & SP
  0xbb: { ins: INS_LAE, mode: ADDR_ABSY,       size: 3, cycles: 4 },

  // ANE (XAA) — A = (A | magic) & X & immediate
  0x8b: { ins: INS_ANE, mode: ADDR_IMM,        size: 2, cycles: 2 },

  // LXA — A = X = (A | magic) & immediate
  0xab: { ins: INS_LXA, mode: ADDR_IMM,        size: 2, cycles: 2 },
};

class CPU {
  // IRQ Types
  IRQ_NORMAL = 0;
  IRQ_NMI = 1;
  IRQ_RESET = 2;

  constructor(nes) {
    this.nes = nes;

    // Main memory (Uint8Array is zero-initialized, so only need to set non-zero regions)
    this.mem = new Uint8Array(0x10000);

    this.mem.fill(0xff, 0, 0x2000);
    for (let p = 0; p < 4; p++) {
      let j = p * 0x800;
      this.mem[j + 0x008] = 0xf7;
      this.mem[j + 0x009] = 0xef;
      this.mem[j + 0x00a] = 0xdf;
      this.mem[j + 0x00f] = 0xbf;
    }

    // CPU Registers:
    this.REG_ACC = 0;
    this.REG_X = 0;
    this.REG_Y = 0;
    // Reset Stack pointer:
    this.REG_SP = 0x01ff;
    // Reset Program counter:
    this.REG_PC = 0x8000 - 1;
    this.REG_PC_NEW = 0x8000 - 1;
    // Reset Status register:
    this.REG_STATUS = 0x28;

    this.setStatus(0x28);

    // Set flags:
    // Note: F_ZERO stores the result byte, not a boolean. When the result
    // is 0, F_ZERO is 0 and the Z flag is considered set. Any non-zero
    // value means the Z flag is clear. This avoids a comparison on every
    // instruction that affects Z. All other flags are 0 or 1.
    this.F_CARRY = 0;
    this.F_DECIMAL = 0;
    this.F_INTERRUPT = 1;
    this.F_INTERRUPT_NEW = 1;
    this.F_OVERFLOW = 0;
    this.F_SIGN = 0;
    this.F_ZERO = 1;

    this.F_NOTUSED = 1;
    this.F_NOTUSED_NEW = 1;
    this.F_BRK = 1;
    this.F_BRK_NEW = 1;

    this.cyclesToHalt = 0;

    // Reset crash flag:
    this.crash = false;

    // Interrupt notification:
    this.irqRequested = false;
    this.irqType = null;

    // NMI edge-detection pipeline matching real 6502 timing.
    // When the PPU's NMI output transitions low→high, nmiRaised is set.
    // The NMI delay depends on which PPU dot within the CPU cycle the edge
    // occurs at: the edge detector samples at φ2 (end of cycle), and the
    // internal signal goes high during φ1 of the NEXT cycle. The signal must
    // be high by the instruction's final cycle for NMI to fire after it.
    //
    // In practice, this means:
    // - VBL edge with >= 5 remaining PPU dots in the instruction: the edge
    //   is detected early enough → NMI fires after this instruction (0-delay).
    //   The frame loop sets nmiImmediate, and the next emulate() fires NMI
    //   without executing an instruction first.
    // - VBL edge with <= 4 remaining dots: the edge is in the last cycle →
    //   NMI fires after the NEXT instruction (1-delay). The frame loop sets
    //   nmiPending, giving standard pipeline behavior.
    // - $2000 write enabling NMI while VBL is active: the write always
    //   happens on the last bus cycle, so nmiRaised→nmiPending promotion
    //   at the start of the next emulate() gives correct 1-delay.
    //
    // See https://www.nesdev.org/wiki/NMI and
    // https://www.nesdev.org/wiki/CPU_interrupts
    this.nmiRaised = false; // Set by _updateNmiOutput() on rising edge
    this.nmiPending = false; // NMI fires at end of this emulate() call
    this.nmiImmediate = false; // NMI fires at START of next emulate() (0-delay)

    // Tracks the last value on the CPU data bus. When reading from unmapped
    // addresses ("open bus"), the NES returns this value. Updated on every
    // read, write, push, pull, and interrupt vector fetch.
    // See https://www.nesdev.org/wiki/Open_bus_behavior
    this.dataBus = 0;

    // Bus cycles completed in the current instruction. Incremented by every
    // load/write/push/pull call. Used by SHx instructions to detect DMC DMA
    // bus hijacking mid-instruction.
    this.instrBusCycles = 0;
    // APU frame counter cycles already advanced mid-instruction (for $4015
    // catch-up). Reset at start of each instruction.
    this.apuCatchupCycles = 0;
    // Running total of CPU cycles executed so far in the current frame.
    // Used to determine APU clock parity for $4016 OUT0 latching.
    // The 2A03's output ports (OUT0-OUT2) only update on APU clock edges,
    // which occur every 2 CPU cycles. This counter lets mapper code check
    // whether a given bus cycle falls on a "put" (even) or "get" (odd)
    // cycle. See https://www.nesdev.org/wiki/CPU_pin_out_and_signal_timing
    this._cpuCycleBase = 0;
    // Records which bus cycle nmiRaised was set during, for 0-delay vs
    // 1-delay NMI determination at end of instruction.
    this.nmiRaisedAtCycle = 0;
    // Sub-dot precision: remaining dots (including the VBlank dot) within
    // the ppu.advanceDots() call that raised NMI. Used together with
    // nmiRaisedAtCycle to compute remaining PPU dots for the >= 5
    // threshold check (matching the old frame loop behavior).
    this.nmiDotsRemainingInStep = 0;
  }

  // Emulates a single CPU instruction, returns the number of cycles
  emulate() {
    // 0-delay NMI: when VBL edge was detected early enough in the previous
    // instruction (>= 5 PPU dots remaining), the NMI signal propagates in
    // time for the final-cycle poll. On real hardware, the NMI sequence
    // begins instead of the next opcode fetch. Fire NMI without executing
    // an instruction. See https://www.nesdev.org/wiki/CPU_interrupts
    if (this.nmiImmediate) {
      this.nmiImmediate = false;
      this.nmiPending = false;
      this.nmiRaised = false;
      this.instrBusCycles = 0;

      this.REG_PC_NEW = this.REG_PC;
      this.F_INTERRUPT_NEW = this.F_INTERRUPT;
      this.doNonMaskableInterrupt(this.getStatus() & 0xef);
      this.REG_PC = this.REG_PC_NEW;
      this.F_INTERRUPT = this.F_INTERRUPT_NEW;
      this.F_BRK = this.F_BRK_NEW;
      this._cpuCycleBase += 7;
      return 7;
    }

    let temp;
    let add;
    // High byte of the base address before index addition, used by
    // SHA/SHX/SHY/SHS to compute the stored value as REG & (H+1).
    // Set in addressing mode cases 8 (ABSX), 9 (ABSY), 11 (POSTIDXIND).
    let baseHigh = 0;

    // Track interrupt overhead cycles. NMI and IRQ each take 7 bus cycles
    // (2 dummy reads + 3 pushes + 2 vector reads) that must be included
    // in the returned cycle count so the frame loop advances the PPU
    // correctly. See https://www.nesdev.org/wiki/CPU_interrupts
    let interruptCycles = 0;

    // Promote nmiRaised to nmiPending. This gives a 1-instruction delay
    // between the NMI assertion (rising edge in _updateNmiOutput) and the
    // NMI being serviced: the instruction that runs in this emulate() call
    // executes first, then NMI fires at the end. On real hardware, the 6502
    // detects NMI edges on the penultimate cycle of each instruction, so
    // the earliest an NMI can fire is after the instruction following the
    // one during which the edge occurred.
    // See https://www.nesdev.org/wiki/CPU_interrupts
    if (this.nmiRaised) {
      this.nmiPending = true;
      this.nmiRaised = false;
    }

    // Check IRQ/reset at the start of each instruction.
    if (this.irqRequested) {
      temp = this.getStatus();

      this.REG_PC_NEW = this.REG_PC;
      this.F_INTERRUPT_NEW = this.F_INTERRUPT;
      switch (this.irqType) {
        case 0: {
          // Normal IRQ:
          if (this.F_INTERRUPT !== 0) {
            break;
          }
          // Clear the B flag (bit 4) for hardware interrupts
          this.doIrq(temp & 0xef);
          interruptCycles = 7;
          break;
        }
        case 2: {
          // Reset:
          this.doResetInterrupt();
          interruptCycles = 7;
          break;
        }
      }

      this.REG_PC = this.REG_PC_NEW;
      this.F_INTERRUPT = this.F_INTERRUPT_NEW;
      this.F_BRK = this.F_BRK_NEW;
      this.irqRequested = false;
    }

    if (this.nes.mmap === null) return 32;

    // Reset bus cycle and APU catch-up counters for this instruction.
    this.instrBusCycles = 0;
    this.apuCatchupCycles = 0;
    this.nmiDotsRemainingInStep = 0;

    // Snapshot how many CPU cycles until the next DMC DMA fetch. Used by
    // SHx instructions to detect bus hijacking mid-instruction.
    this._dmcFetchCycles = this._cyclesToNextDmcFetch();

    // --- Fetch ---
    // Read the opcode byte at PC. (REG_PC is one less than the actual
    // instruction address — a convenience so that the post-increment in
    // REG_PC += opinfo.size below lands on the next instruction.)
    let opcode = this.loadFromCartridge(this.REG_PC + 1);
    this.dataBus = opcode;
    this.instrBusCycles = 1;
    this.nes.ppu.advanceDots(3);

    // --- Decode ---
    // Look up the opcode in the table at the top of this file to find out
    // which instruction this is, what addressing mode to use, how many
    // bytes it consumes, and its base cycle count. See OPCODE_TABLE.
    let opinfo = OPCODE_TABLE[opcode] ?? INVALID_OPCODE;
    let cycleCount = opinfo.cycles;
    let cycleAdd = 0; // extra cycles from page-crossing in indexed modes
    let addrMode = opinfo.mode;

    // Advance PC past the instruction's operand bytes so it points at the
    // next instruction. (opaddr keeps a copy of the pre-advance PC for
    // relative branches and the operand-byte fetches below.)
    let opaddr = this.REG_PC;
    this.REG_PC += opinfo.size;

    // --- Address (decode continued) ---
    // Each addressing mode has its own rules for turning the operand bytes
    // into an effective address (or literal value) for the instruction to
    // work with. The numeric `case N:` labels here match the ADDR_* values
    // at the top of the file — e.g. `case 4:` is ADDR_ACC. This switch
    // also performs any "dummy reads" the real 6502 does on certain modes;
    // those are real bus cycles that can trigger I/O side effects, so
    // skipping them would be a correctness bug, not an optimization.
    let addr = 0;
    switch (addrMode) {
      case 0: {
        // Zero Page mode. Use the address given after the opcode,
        // but without high byte.
        addr = this.loadDirect(opaddr + 2);
        break;
      }
      case 1: {
        // Relative mode.
        addr = this.loadDirect(opaddr + 2);
        if (addr < 0x80) {
          addr += this.REG_PC;
        } else {
          addr += this.REG_PC - 256;
        }
        break;
      }
      case 2: {
        // Implied mode. The 6502's second cycle performs a dummy read of the
        // byte at PC (the next opcode). This is a real bus operation that
        // updates the data bus and can trigger I/O side effects.
        // Note: opaddr is REG_PC which is one less than the actual instruction
        // address (opcode is at opaddr+1), so the dummy read targets opaddr+2.
        // See https://www.nesdev.org/wiki/CPU_addressing_modes
        this.loadDirect(opaddr + 2);
        break;
      }
      case 3: {
        // Absolute mode. Use the two bytes following the opcode as
        // an address.
        addr = this.load16bit(opaddr + 2);
        break;
      }
      case 4: {
        // Accumulator mode. The address is in the accumulator register.
        // Like implied mode, the 6502 performs a dummy read of the byte at PC
        // during its second cycle (opaddr+2, see case 2 comment).
        // See https://www.nesdev.org/wiki/CPU_addressing_modes
        this.loadDirect(opaddr + 2);
        addr = this.REG_ACC;
        break;
      }
      case 5: {
        // Immediate mode. The value is given after the opcode.
        addr = this.REG_PC;
        break;
      }
      case 6: {
        // Zero Page Indexed mode, X as index. Use the address given
        // after the opcode, then add the X register to get the final address.
        // The 6502 reads from the unindexed zero-page address while adding X.
        // This "dummy read" is a real bus cycle that can trigger I/O side effects.
        // See https://www.nesdev.org/wiki/CPU_addressing_modes
        let zpBase6 = this.loadDirect(opaddr + 2);
        this.loadDirect(zpBase6); // dummy read from unindexed zero-page address
        addr = (zpBase6 + this.REG_X) & 0xff;
        break;
      }
      case 7: {
        // Zero Page Indexed mode, Y as index. Same dummy read behavior as case 6.
        let zpBase7 = this.loadDirect(opaddr + 2);
        this.loadDirect(zpBase7); // dummy read from unindexed zero-page address
        addr = (zpBase7 + this.REG_Y) & 0xff;
        break;
      }
      case 8: {
        // Absolute Indexed Mode, X as index.
        addr = this.load16bit(opaddr + 2);
        baseHigh = (addr >> 8) & 0xff;
        if ((addr & 0xff00) !== ((addr + this.REG_X) & 0xff00)) {
          // Page boundary crossed: the 6502 first reads from the "wrong"
          // address (correct low byte, uncorrected high byte) before reading
          // the correct one. This dummy read is a real bus cycle that updates
          // the data bus and can trigger I/O side effects.
          // See https://www.nesdev.org/wiki/CPU_addressing_modes
          this.load((addr & 0xff00) | ((addr + this.REG_X) & 0xff));
          cycleAdd = 1;
        }
        addr += this.REG_X;
        break;
      }
      case 9: {
        // Absolute Indexed Mode, Y as index.
        // Same page-crossing dummy read behavior as case 8.
        addr = this.load16bit(opaddr + 2);
        baseHigh = (addr >> 8) & 0xff;
        if ((addr & 0xff00) !== ((addr + this.REG_Y) & 0xff00)) {
          this.load((addr & 0xff00) | ((addr + this.REG_Y) & 0xff));
          cycleAdd = 1;
        }
        addr += this.REG_Y;
        break;
      }
      case 10: {
        // Pre-indexed Indirect mode, (d,X). Read pointer from zero page,
        // add X, then read the 16-bit effective address. Wraps within zero page.
        // Dummy read from the unindexed pointer address while adding X.
        let zpPtr10 = this.loadDirect(opaddr + 2);
        this.loadDirect(zpPtr10); // dummy read: 6502 reads from ptr before adding X
        let zpAddr10 = (zpPtr10 + this.REG_X) & 0xff;
        addr =
          this.loadDirect(zpAddr10) |
          (this.loadDirect((zpAddr10 + 1) & 0xff) << 8);
        break;
      }
      case 11: {
        // Post-indexed Indirect mode, (d),Y. Read 16-bit base address from
        // zero page, then add Y. Page-crossing dummy read as in case 8.
        let zpAddr = this.loadDirect(opaddr + 2);
        addr =
          this.loadDirect(zpAddr) | (this.loadDirect((zpAddr + 1) & 0xff) << 8);
        baseHigh = (addr >> 8) & 0xff;
        if ((addr & 0xff00) !== ((addr + this.REG_Y) & 0xff00)) {
          this.load((addr & 0xff00) | ((addr + this.REG_Y) & 0xff));
          cycleAdd = 1;
        }
        addr += this.REG_Y;
        break;
      }
      case 12: {
        // Indirect Absolute mode (JMP indirect). Find the 16-bit address
        // contained at the given location. The 6502 has a famous bug: when
        // the pointer's low byte is $FF, the high byte wraps within the
        // same page instead of crossing to the next page.
        addr = this.load16bit(opaddr + 2); // Find op
        var hiAddr = (addr & 0xff00) | (((addr & 0xff) + 1) & 0xff);
        addr = this.load(addr) | (this.load(hiAddr) << 8);
        break;
      }
    }
    // Wrap around for addresses above 0xFFFF:
    addr &= 0xffff;

    // ----------------------------------------------------------------------------------------------------
    // Execute
    // ----------------------------------------------------------------------------------------------------
    //
    // Now that we know which instruction this is (opinfo.ins) and where
    // its operand lives (addr), actually run the operation. Each `case`
    // below handles one instruction; the numeric labels match the INS_*
    // values at the top of the file (e.g. `case 0:` is INS_ADC).
    //
    // Several instructions read their operand's addressing mode again
    // (via `addrMode`) to handle mode-specific quirks — e.g. ASL/LSR/ROL
    // /ROR operate on the accumulator directly when addrMode == ADDR_ACC
    // instead of reading and writing memory; stores and RMW instructions
    // perform extra dummy reads/writes in indexed modes to match the
    // real 6502's bus timing.
    //
    // The case labels are raw integers rather than INS_* constants so
    // that V8 compiles this dispatch into a jump table — it only does
    // that when every case expression is a literal integer at parse
    // time. With ~78 cases on the hottest loop in the emulator, using
    // constants would noticeably slow the dispatch.
    switch (opinfo.ins) {
      case 0: {
        // *******
        // * ADC *
        // *******

        // Add with carry.
        add = this.load(addr);
        temp = this.REG_ACC + add + this.F_CARRY;

        if (
          ((this.REG_ACC ^ add) & 0x80) === 0 &&
          ((this.REG_ACC ^ temp) & 0x80) !== 0
        ) {
          this.F_OVERFLOW = 1;
        } else {
          this.F_OVERFLOW = 0;
        }
        this.F_CARRY = temp > 255 ? 1 : 0;
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp & 0xff;
        this.REG_ACC = temp & 255;
        cycleCount += cycleAdd;
        break;
      }
      case 1: {
        // *******
        // * AND *
        // *******

        // AND memory with accumulator.
        this.REG_ACC = this.REG_ACC & this.load(addr);
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        this.F_ZERO = this.REG_ACC;
        cycleCount += cycleAdd;
        break;
      }
      case 2: {
        // *******
        // * ASL *
        // *******

        // Shift left one bit
        if (addrMode === ADDR_ACC) {
          this.F_CARRY = (this.REG_ACC >> 7) & 1;
          this.REG_ACC = (this.REG_ACC << 1) & 255;
          this.F_SIGN = (this.REG_ACC >> 7) & 1;
          this.F_ZERO = this.REG_ACC;
        } else {
          // Read-Modify-Write (RMW) cycle pattern for memory operands:
          //   1. For indexed modes without page crossing, the 6502 always
          //      does a dummy read (same as stores, see case 47/STA).
          //   2. Read the value from the effective address.
          //   3. Write the ORIGINAL value back (dummy write) while computing.
          //   4. Write the MODIFIED value.
          // The dummy write is a real bus cycle — writing to I/O registers
          // like PPU $2007 twice has visible side effects.
          // See https://www.nesdev.org/wiki/CPU_addressing_modes (RMW column)
          if (
            cycleAdd === 0 &&
            (addrMode === ADDR_ABSX ||
              addrMode === ADDR_ABSY ||
              addrMode === ADDR_POSTIDXIND)
          ) {
            this.load(addr); // dummy read (indexed, no page crossing)
          }
          temp = this.load(addr);
          this.write(addr, temp); // dummy write (original value)
          this.F_CARRY = (temp >> 7) & 1;
          temp = (temp << 1) & 255;
          this.F_SIGN = (temp >> 7) & 1;
          this.F_ZERO = temp;
          this.write(addr, temp);
        }
        break;
      }
      case 3: {
        // *******
        // * BCC *
        // *******

        // Branch on carry clear
        if (this.F_CARRY === 0) {
          cycleCount += this._takeBranch(opaddr, addr);
        }
        break;
      }
      case 4: {
        // *******
        // * BCS *
        // *******

        // Branch on carry set
        if (this.F_CARRY === 1) {
          cycleCount += this._takeBranch(opaddr, addr);
        }
        break;
      }
      case 5: {
        // *******
        // * BEQ *
        // *******

        // Branch on zero
        if (this.F_ZERO === 0) {
          cycleCount += this._takeBranch(opaddr, addr);
        }
        break;
      }
      case 6: {
        // *******
        // * BIT *
        // *******

        temp = this.load(addr);
        this.F_SIGN = (temp >> 7) & 1;
        this.F_OVERFLOW = (temp >> 6) & 1;
        temp &= this.REG_ACC;
        this.F_ZERO = temp;
        break;
      }
      case 7: {
        // *******
        // * BMI *
        // *******

        // Branch on negative result
        if (this.F_SIGN === 1) {
          cycleCount += this._takeBranch(opaddr, addr);
        }
        break;
      }
      case 8: {
        // *******
        // * BNE *
        // *******

        // Branch on not zero
        if (this.F_ZERO !== 0) {
          cycleCount += this._takeBranch(opaddr, addr);
        }
        break;
      }
      case 9: {
        // *******
        // * BPL *
        // *******

        // Branch on positive result
        if (this.F_SIGN === 0) {
          cycleCount += this._takeBranch(opaddr, addr);
        }
        break;
      }
      case 10: {
        // *******
        // * BRK *
        // *******

        this.REG_PC += 2;
        this.push((this.REG_PC >> 8) & 255);
        this.push(this.REG_PC & 255);
        this.F_BRK = 1;
        this.push(this.getStatus());

        this.F_INTERRUPT = 1;
        //this.REG_PC = load(0xFFFE) | (load(0xFFFF) << 8);
        this.REG_PC = this.load16bit(0xfffe);
        this.REG_PC--;
        break;
      }
      case 11: {
        // *******
        // * BVC *
        // *******

        // Branch on overflow clear
        if (this.F_OVERFLOW === 0) {
          cycleCount += this._takeBranch(opaddr, addr);
        }
        break;
      }
      case 12: {
        // *******
        // * BVS *
        // *******

        // Branch on overflow set
        if (this.F_OVERFLOW === 1) {
          cycleCount += this._takeBranch(opaddr, addr);
        }
        break;
      }
      case 13: {
        // *******
        // * CLC *
        // *******

        // Clear carry flag
        this.F_CARRY = 0;
        break;
      }
      case 14: {
        // *******
        // * CLD *
        // *******

        // Clear decimal flag
        this.F_DECIMAL = 0;
        break;
      }
      case 15: {
        // *******
        // * CLI *
        // *******

        // Clear interrupt flag
        this.F_INTERRUPT = 0;
        break;
      }
      case 16: {
        // *******
        // * CLV *
        // *******

        // Clear overflow flag
        this.F_OVERFLOW = 0;
        break;
      }
      case 17: {
        // *******
        // * CMP *
        // *******

        // Compare memory and accumulator:
        temp = this.REG_ACC - this.load(addr);
        this.F_CARRY = temp >= 0 ? 1 : 0;
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp & 0xff;
        cycleCount += cycleAdd;
        break;
      }
      case 18: {
        // *******
        // * CPX *
        // *******

        // Compare memory and index X:
        temp = this.REG_X - this.load(addr);
        this.F_CARRY = temp >= 0 ? 1 : 0;
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp & 0xff;
        break;
      }
      case 19: {
        // *******
        // * CPY *
        // *******

        // Compare memory and index Y:
        temp = this.REG_Y - this.load(addr);
        this.F_CARRY = temp >= 0 ? 1 : 0;
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp & 0xff;
        break;
      }
      case 20: {
        // *******
        // * DEC *
        // *******

        // Decrement memory by one (RMW pattern, see ASL case 2):
        if (
          cycleAdd === 0 &&
          (addrMode === ADDR_ABSX ||
            addrMode === ADDR_ABSY ||
            addrMode === ADDR_POSTIDXIND)
        ) {
          this.load(addr); // dummy read (indexed, no page crossing)
        }
        temp = this.load(addr);
        this.write(addr, temp); // dummy write (original value)
        temp = (temp - 1) & 0xff;
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp;
        this.write(addr, temp);
        break;
      }
      case 21: {
        // *******
        // * DEX *
        // *******

        // Decrement index X by one:
        this.REG_X = (this.REG_X - 1) & 0xff;
        this.F_SIGN = (this.REG_X >> 7) & 1;
        this.F_ZERO = this.REG_X;
        break;
      }
      case 22: {
        // *******
        // * DEY *
        // *******

        // Decrement index Y by one:
        this.REG_Y = (this.REG_Y - 1) & 0xff;
        this.F_SIGN = (this.REG_Y >> 7) & 1;
        this.F_ZERO = this.REG_Y;
        break;
      }
      case 23: {
        // *******
        // * EOR *
        // *******

        // XOR Memory with accumulator, store in accumulator:
        this.REG_ACC = (this.load(addr) ^ this.REG_ACC) & 0xff;
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        this.F_ZERO = this.REG_ACC;
        cycleCount += cycleAdd;
        break;
      }
      case 24: {
        // *******
        // * INC *
        // *******

        // Increment memory by one (RMW pattern, see ASL case 2):
        if (
          cycleAdd === 0 &&
          (addrMode === ADDR_ABSX ||
            addrMode === ADDR_ABSY ||
            addrMode === ADDR_POSTIDXIND)
        ) {
          this.load(addr); // dummy read (indexed, no page crossing)
        }
        temp = this.load(addr);
        this.write(addr, temp); // dummy write (original value)
        temp = (temp + 1) & 0xff;
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp;
        this.write(addr, temp);
        break;
      }
      case 25: {
        // *******
        // * INX *
        // *******

        // Increment index X by one:
        this.REG_X = (this.REG_X + 1) & 0xff;
        this.F_SIGN = (this.REG_X >> 7) & 1;
        this.F_ZERO = this.REG_X;
        break;
      }
      case 26: {
        // *******
        // * INY *
        // *******

        // Increment index Y by one:
        this.REG_Y++;
        this.REG_Y &= 0xff;
        this.F_SIGN = (this.REG_Y >> 7) & 1;
        this.F_ZERO = this.REG_Y;
        break;
      }
      case 27: {
        // *******
        // * JMP *
        // *******

        // Jump to new location:
        this.REG_PC = addr - 1;
        break;
      }
      case 28: {
        // *******
        // * JSR *
        // *******

        // Jump to new location, saving return address.
        // Push return address on stack:
        this.push((this.REG_PC >> 8) & 255);
        this.push(this.REG_PC & 255);
        // On real 6502, JSR reads the high byte of the target address as its
        // last cycle (after the pushes), updating the data bus. This matters
        // for open bus behavior when JSR targets unmapped addresses.
        // See https://www.nesdev.org/wiki/Open_bus_behavior
        this.loadDirect(opaddr + 3);
        this.REG_PC = addr - 1;
        break;
      }
      case 29: {
        // *******
        // * LDA *
        // *******

        // Load accumulator with memory:
        this.REG_ACC = this.load(addr);
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        this.F_ZERO = this.REG_ACC;
        cycleCount += cycleAdd;
        break;
      }
      case 30: {
        // *******
        // * LDX *
        // *******

        // Load index X with memory:
        this.REG_X = this.load(addr);
        this.F_SIGN = (this.REG_X >> 7) & 1;
        this.F_ZERO = this.REG_X;
        cycleCount += cycleAdd;
        break;
      }
      case 31: {
        // *******
        // * LDY *
        // *******

        // Load index Y with memory:
        this.REG_Y = this.load(addr);
        this.F_SIGN = (this.REG_Y >> 7) & 1;
        this.F_ZERO = this.REG_Y;
        cycleCount += cycleAdd;
        break;
      }
      case 32: {
        // *******
        // * LSR *
        // *******

        // Shift right one bit (RMW pattern, see ASL case 2):
        if (addrMode === ADDR_ACC) {
          temp = this.REG_ACC & 0xff;
          this.F_CARRY = temp & 1;
          temp >>= 1;
          this.REG_ACC = temp;
        } else {
          if (
            cycleAdd === 0 &&
            (addrMode === ADDR_ABSX ||
              addrMode === ADDR_ABSY ||
              addrMode === ADDR_POSTIDXIND)
          ) {
            this.load(addr); // dummy read (indexed, no page crossing)
          }
          temp = this.load(addr) & 0xff;
          this.write(addr, temp); // dummy write (original value)
          this.F_CARRY = temp & 1;
          temp >>= 1;
          this.write(addr, temp);
        }
        this.F_SIGN = 0;
        this.F_ZERO = temp;
        break;
      }
      case 33: {
        // *******
        // * NOP *
        // *******

        // No OPeration.
        // Ignore.
        break;
      }
      case 34: {
        // *******
        // * ORA *
        // *******

        // OR memory with accumulator, store in accumulator.
        temp = (this.load(addr) | this.REG_ACC) & 255;
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp;
        this.REG_ACC = temp;
        cycleCount += cycleAdd;
        break;
      }
      case 35: {
        // *******
        // * PHA *
        // *******

        // Push accumulator on stack
        this.push(this.REG_ACC);
        break;
      }
      case 36: {
        // *******
        // * PHP *
        // *******

        // Push processor status on stack
        this.F_BRK = 1;
        this.push(this.getStatus());
        break;
      }
      case 37: {
        // *******
        // * PLA *
        // *******

        // Pull accumulator from stack
        this.REG_ACC = this.pull();
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        this.F_ZERO = this.REG_ACC;
        break;
      }
      case 38: {
        // *******
        // * PLP *
        // *******

        // Pull processor status from stack
        this.setStatusFromStack(this.pull());
        break;
      }
      case 39: {
        // *******
        // * ROL *
        // *******

        // Rotate one bit left (RMW pattern, see ASL case 2)
        if (addrMode === ADDR_ACC) {
          temp = this.REG_ACC;
          add = this.F_CARRY;
          this.F_CARRY = (temp >> 7) & 1;
          temp = ((temp << 1) & 0xff) + add;
          this.REG_ACC = temp;
        } else {
          if (
            cycleAdd === 0 &&
            (addrMode === ADDR_ABSX ||
              addrMode === ADDR_ABSY ||
              addrMode === ADDR_POSTIDXIND)
          ) {
            this.load(addr); // dummy read (indexed, no page crossing)
          }
          temp = this.load(addr);
          this.write(addr, temp); // dummy write (original value)
          add = this.F_CARRY;
          this.F_CARRY = (temp >> 7) & 1;
          temp = ((temp << 1) & 0xff) + add;
          this.write(addr, temp);
        }
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp;
        break;
      }
      case 40: {
        // *******
        // * ROR *
        // *******

        // Rotate one bit right (RMW pattern, see ASL case 2)
        if (addrMode === ADDR_ACC) {
          add = this.F_CARRY << 7;
          this.F_CARRY = this.REG_ACC & 1;
          temp = (this.REG_ACC >> 1) + add;
          this.REG_ACC = temp;
        } else {
          if (
            cycleAdd === 0 &&
            (addrMode === ADDR_ABSX ||
              addrMode === ADDR_ABSY ||
              addrMode === ADDR_POSTIDXIND)
          ) {
            this.load(addr); // dummy read (indexed, no page crossing)
          }
          temp = this.load(addr);
          this.write(addr, temp); // dummy write (original value)
          add = this.F_CARRY << 7;
          this.F_CARRY = temp & 1;
          temp = (temp >> 1) + add;
          this.write(addr, temp);
        }
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp;
        break;
      }
      case 41: {
        // *******
        // * RTI *
        // *******

        // Return from interrupt. Pull status and PC from stack.
        this.setStatusFromStack(this.pull());

        this.REG_PC = this.pull();
        this.REG_PC += this.pull() << 8;
        if (this.REG_PC === 0xffff) {
          return;
        }
        this.REG_PC--;
        break;
      }
      case 42: {
        // *******
        // * RTS *
        // *******

        // Return from subroutine. Pull PC from stack.

        this.REG_PC = this.pull();
        this.REG_PC += this.pull() << 8;

        if (this.REG_PC === 0xffff) {
          return; // return from NSF play routine:
        }
        break;
      }
      case 43: {
        // *******
        // * SBC *
        // *******

        add = this.load(addr);
        temp = this.REG_ACC - add - (1 - this.F_CARRY);
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp & 0xff;
        if (
          ((this.REG_ACC ^ temp) & 0x80) !== 0 &&
          ((this.REG_ACC ^ add) & 0x80) !== 0
        ) {
          this.F_OVERFLOW = 1;
        } else {
          this.F_OVERFLOW = 0;
        }
        this.F_CARRY = temp < 0 ? 0 : 1;
        this.REG_ACC = temp & 0xff;
        cycleCount += cycleAdd;
        break;
      }
      case 44: {
        // *******
        // * SEC *
        // *******

        // Set carry flag
        this.F_CARRY = 1;
        break;
      }
      case 45: {
        // *******
        // * SED *
        // *******

        // Set decimal mode
        this.F_DECIMAL = 1;
        break;
      }
      case 46: {
        // *******
        // * SEI *
        // *******

        // Set interrupt disable status
        this.F_INTERRUPT = 1;
        break;
      }
      case 47: {
        // *******
        // * STA *
        // *******

        // Store accumulator in memory.
        // Unlike loads, stores ALWAYS take the extra cycle for indexed
        // addressing, even without a page crossing. The page-crossing case
        // already added the dummy read in the addressing mode (cases 8/9/11);
        // this handles the non-crossing case.
        if (
          cycleAdd === 0 &&
          (addrMode === ADDR_ABSX ||
            addrMode === ADDR_ABSY ||
            addrMode === ADDR_POSTIDXIND)
        ) {
          this.load(addr);
        }
        this.write(addr, this.REG_ACC);
        break;
      }
      case 48: {
        // *******
        // * STX *
        // *******

        // Store index X in memory
        this.write(addr, this.REG_X);
        break;
      }
      case 49: {
        // *******
        // * STY *
        // *******

        // Store index Y in memory:
        this.write(addr, this.REG_Y);
        break;
      }
      case 50: {
        // *******
        // * TAX *
        // *******

        // Transfer accumulator to index X:
        this.REG_X = this.REG_ACC;
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        this.F_ZERO = this.REG_ACC;
        break;
      }
      case 51: {
        // *******
        // * TAY *
        // *******

        // Transfer accumulator to index Y:
        this.REG_Y = this.REG_ACC;
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        this.F_ZERO = this.REG_ACC;
        break;
      }
      case 52: {
        // *******
        // * TSX *
        // *******

        // Transfer stack pointer to index X:
        this.REG_X = this.REG_SP & 0xff;
        this.F_SIGN = (this.REG_SP >> 7) & 1;
        this.F_ZERO = this.REG_X;
        break;
      }
      case 53: {
        // *******
        // * TXA *
        // *******

        // Transfer index X to accumulator:
        this.REG_ACC = this.REG_X;
        this.F_SIGN = (this.REG_X >> 7) & 1;
        this.F_ZERO = this.REG_X;
        break;
      }
      case 54: {
        // *******
        // * TXS *
        // *******

        // Transfer index X to stack pointer:
        this.REG_SP = this.REG_X & 0xff;
        break;
      }
      case 55: {
        // *******
        // * TYA *
        // *******

        // Transfer index Y to accumulator:
        this.REG_ACC = this.REG_Y;
        this.F_SIGN = (this.REG_Y >> 7) & 1;
        this.F_ZERO = this.REG_Y;
        break;
      }
      case 56: {
        // *******
        // * ALR *
        // *******

        // Shift right one bit after ANDing:
        temp = this.REG_ACC & this.load(addr);
        this.F_CARRY = temp & 1;
        this.REG_ACC = this.F_ZERO = temp >> 1;
        this.F_SIGN = 0;
        break;
      }
      case 57: {
        // *******
        // * ANC *
        // *******

        // AND accumulator, setting carry to bit 7 result.
        this.REG_ACC = this.F_ZERO = this.REG_ACC & this.load(addr);
        this.F_CARRY = this.F_SIGN = (this.REG_ACC >> 7) & 1;
        break;
      }
      case 58: {
        // *******
        // * ARR *
        // *******

        // Rotate right one bit after ANDing:
        temp = this.REG_ACC & this.load(addr);
        this.REG_ACC = this.F_ZERO = (temp >> 1) + (this.F_CARRY << 7);
        this.F_SIGN = this.F_CARRY;
        this.F_CARRY = (temp >> 7) & 1;
        this.F_OVERFLOW = ((temp >> 7) ^ (temp >> 6)) & 1;
        break;
      }
      case 59: {
        // *******
        // * AXS *
        // *******

        // Set X to (X AND A) - value.
        // Like CMP, AXS sets N, Z, C but does NOT affect the V (overflow) flag.
        // https://www.nesdev.org/wiki/Programming_with_unofficial_opcodes
        temp = (this.REG_X & this.REG_ACC) - this.load(addr);
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp & 0xff;
        this.F_CARRY = temp < 0 ? 0 : 1;
        this.REG_X = temp & 0xff;
        break;
      }
      case 60: {
        // *******
        // * LAX *
        // *******

        // Load A and X with memory:
        this.REG_ACC = this.REG_X = this.F_ZERO = this.load(addr);
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        cycleCount += cycleAdd;
        break;
      }
      case 61: {
        // *******
        // * SAX *
        // *******

        // Store A AND X in memory:
        this.write(addr, this.REG_ACC & this.REG_X);
        break;
      }
      case 62: {
        // *******
        // * DCP *
        // *******

        // Decrement memory then compare (unofficial, RMW pattern see ASL case 2):
        if (
          cycleAdd === 0 &&
          (addrMode === ADDR_ABSX ||
            addrMode === ADDR_ABSY ||
            addrMode === ADDR_POSTIDXIND)
        ) {
          this.load(addr); // dummy read (indexed, no page crossing)
        }
        temp = this.load(addr);
        this.write(addr, temp); // dummy write (original value)
        temp = (temp - 1) & 0xff;
        this.write(addr, temp);

        // Then compare with the accumulator:
        temp = this.REG_ACC - temp;
        this.F_CARRY = temp >= 0 ? 1 : 0;
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp & 0xff;
        break;
      }
      case 63: {
        // *******
        // * ISC *
        // *******

        // Increment memory then subtract (unofficial, RMW pattern see ASL case 2):
        if (
          cycleAdd === 0 &&
          (addrMode === ADDR_ABSX ||
            addrMode === ADDR_ABSY ||
            addrMode === ADDR_POSTIDXIND)
        ) {
          this.load(addr); // dummy read (indexed, no page crossing)
        }
        temp = this.load(addr);
        this.write(addr, temp); // dummy write (original value)
        temp = (temp + 1) & 0xff;
        this.write(addr, temp);

        // Then subtract from the accumulator:
        let isb_val = temp;
        temp = this.REG_ACC - isb_val - (1 - this.F_CARRY);
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp & 0xff;
        if (
          ((this.REG_ACC ^ temp) & 0x80) !== 0 &&
          ((this.REG_ACC ^ isb_val) & 0x80) !== 0
        ) {
          this.F_OVERFLOW = 1;
        } else {
          this.F_OVERFLOW = 0;
        }
        this.F_CARRY = temp < 0 ? 0 : 1;
        this.REG_ACC = temp & 0xff;
        break;
      }
      case 64: {
        // *******
        // * RLA *
        // *******

        // Rotate left then AND (unofficial, RMW pattern see ASL case 2)
        if (
          cycleAdd === 0 &&
          (addrMode === ADDR_ABSX ||
            addrMode === ADDR_ABSY ||
            addrMode === ADDR_POSTIDXIND)
        ) {
          this.load(addr); // dummy read (indexed, no page crossing)
        }
        temp = this.load(addr);
        this.write(addr, temp); // dummy write (original value)
        add = this.F_CARRY;
        this.F_CARRY = (temp >> 7) & 1;
        temp = ((temp << 1) & 0xff) + add;
        this.write(addr, temp);

        // Then AND with the accumulator.
        this.REG_ACC = this.REG_ACC & temp;
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        this.F_ZERO = this.REG_ACC;
        break;
      }
      case 65: {
        // *******
        // * RRA *
        // *******

        // Rotate right then add (unofficial, RMW pattern see ASL case 2)
        if (
          cycleAdd === 0 &&
          (addrMode === ADDR_ABSX ||
            addrMode === ADDR_ABSY ||
            addrMode === ADDR_POSTIDXIND)
        ) {
          this.load(addr); // dummy read (indexed, no page crossing)
        }
        temp = this.load(addr);
        this.write(addr, temp); // dummy write (original value)
        add = this.F_CARRY << 7;
        this.F_CARRY = temp & 1;
        temp = (temp >> 1) + add;
        this.write(addr, temp);

        // Then add to the accumulator
        let rra_val = temp;
        temp = this.REG_ACC + rra_val + this.F_CARRY;

        if (
          ((this.REG_ACC ^ rra_val) & 0x80) === 0 &&
          ((this.REG_ACC ^ temp) & 0x80) !== 0
        ) {
          this.F_OVERFLOW = 1;
        } else {
          this.F_OVERFLOW = 0;
        }
        this.F_CARRY = temp > 255 ? 1 : 0;
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp & 0xff;
        this.REG_ACC = temp & 255;
        break;
      }
      case 66: {
        // *******
        // * SLO *
        // *******

        // Shift left then OR (unofficial, RMW pattern see ASL case 2)
        if (
          cycleAdd === 0 &&
          (addrMode === ADDR_ABSX ||
            addrMode === ADDR_ABSY ||
            addrMode === ADDR_POSTIDXIND)
        ) {
          this.load(addr); // dummy read (indexed, no page crossing)
        }
        temp = this.load(addr);
        this.write(addr, temp); // dummy write (original value)
        this.F_CARRY = (temp >> 7) & 1;
        temp = (temp << 1) & 255;
        this.write(addr, temp);

        // Then OR with the accumulator.
        this.REG_ACC = this.REG_ACC | temp;
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        this.F_ZERO = this.REG_ACC;
        break;
      }
      case 67: {
        // *******
        // * SRE *
        // *******

        // Shift right then XOR (unofficial, RMW pattern see ASL case 2)
        if (
          cycleAdd === 0 &&
          (addrMode === ADDR_ABSX ||
            addrMode === ADDR_ABSY ||
            addrMode === ADDR_POSTIDXIND)
        ) {
          this.load(addr); // dummy read (indexed, no page crossing)
        }
        temp = this.load(addr) & 0xff;
        this.write(addr, temp); // dummy write (original value)
        this.F_CARRY = temp & 1;
        temp >>= 1;
        this.write(addr, temp);

        // Then XOR with the accumulator.
        this.REG_ACC = this.REG_ACC ^ temp;
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        this.F_ZERO = this.REG_ACC;
        break;
      }
      case 68: {
        // *******
        // * SKB *
        // *******

        // Do nothing
        break;
      }
      case 69: {
        // *******
        // * IGN *
        // *******

        // Do nothing but load.
        // TODO: Properly implement the double-reads.
        this.load(addr);
        cycleCount += cycleAdd;
        break;
      }
      case 71: {
        // *******
        // * SHA * (AHX/AXA)
        // *******

        // Store A AND X AND (high byte of base address + 1).
        // On page crossing, the high byte of the effective address is
        // replaced with the stored value — a quirk of the 6502's internal
        // bus arbitration during indexed addressing.
        // See https://www.nesdev.org/wiki/Programming_with_unofficial_opcodes

        // Stores always perform the indexed dummy read, even without page
        // crossing. This is a real bus cycle needed for correct timing
        // (and DMA overlap detection).
        // See https://www.nesdev.org/wiki/CPU_addressing_modes
        if (cycleAdd === 0) {
          this.load(addr);
        }
        // When a DMC DMA fires during this instruction's read cycles, the
        // DMA hijacks the internal bus and the "& (H+1)" factor is dropped.
        // See _cyclesToNextDmcFetch() for the full explanation, and
        // AccuracyCoin.asm lines 4441-4460 for the test ROM's DMA sync.
        let dmaDuringInstr =
          this._dmcFetchCycles > 0 &&
          this._dmcFetchCycles <= this.instrBusCycles;
        let shaVal = dmaDuringInstr
          ? this.REG_ACC & this.REG_X
          : this.REG_ACC & this.REG_X & (((baseHigh + 1) & 0xff) | 0);
        if (cycleAdd === 1) {
          addr = (shaVal << 8) | (addr & 0xff);
        }
        this.write(addr, shaVal);
        break;
      }
      case 72: {
        // *******
        // * SHS * (TAS/XAS)
        // *******

        // Transfer A AND X to SP, then store SP AND (high byte + 1).
        // Same page-crossing address glitch as SHA.
        // See https://www.nesdev.org/wiki/Programming_with_unofficial_opcodes
        if (cycleAdd === 0) {
          this.load(addr); // forced dummy read (see case 71 comment)
        }
        let dmaDuringInstr2 =
          this._dmcFetchCycles > 0 &&
          this._dmcFetchCycles <= this.instrBusCycles;
        this.REG_SP = 0x0100 | (this.REG_ACC & this.REG_X);
        let shsVal = dmaDuringInstr2
          ? this.REG_SP & 0xff
          : this.REG_SP & 0xff & ((baseHigh + 1) & 0xff);
        if (cycleAdd === 1) {
          addr = (shsVal << 8) | (addr & 0xff);
        }
        this.write(addr, shsVal);
        break;
      }
      case 73: {
        // *******
        // * SHY * (SYA/SAY)
        // *******

        // Store Y AND (high byte of base address + 1).
        // Same page-crossing address glitch as SHA.
        // See https://www.nesdev.org/wiki/Programming_with_unofficial_opcodes
        if (cycleAdd === 0) {
          this.load(addr); // forced dummy read (see case 71 comment)
        }
        let dmaDuringInstr3 =
          this._dmcFetchCycles > 0 &&
          this._dmcFetchCycles <= this.instrBusCycles;
        let shyVal = dmaDuringInstr3
          ? this.REG_Y
          : this.REG_Y & ((baseHigh + 1) & 0xff);
        if (cycleAdd === 1) {
          addr = (shyVal << 8) | (addr & 0xff);
        }
        this.write(addr, shyVal);
        break;
      }
      case 74: {
        // *******
        // * SHX * (SXA/XAS)
        // *******

        // Store X AND (high byte of base address + 1).
        // Same page-crossing address glitch as SHA.
        // See https://www.nesdev.org/wiki/Programming_with_unofficial_opcodes
        if (cycleAdd === 0) {
          this.load(addr); // forced dummy read (see case 71 comment)
        }
        let dmaDuringInstr4 =
          this._dmcFetchCycles > 0 &&
          this._dmcFetchCycles <= this.instrBusCycles;
        let shxVal = dmaDuringInstr4
          ? this.REG_X
          : this.REG_X & ((baseHigh + 1) & 0xff);
        if (cycleAdd === 1) {
          addr = (shxVal << 8) | (addr & 0xff);
        }
        this.write(addr, shxVal);
        break;
      }
      case 75: {
        // *******
        // * LAE * (LAS/LAR)
        // *******

        // Load A, X, and SP with (memory AND SP).
        // See https://www.nesdev.org/wiki/Programming_with_unofficial_opcodes
        temp = this.load(addr) & (this.REG_SP & 0xff);
        this.REG_ACC = this.REG_X = this.F_ZERO = temp;
        this.REG_SP = 0x0100 | temp;
        this.F_SIGN = (temp >> 7) & 1;
        cycleCount += cycleAdd;
        break;
      }
      case 76: {
        // *******
        // * ANE * (XAA)
        // *******

        // A = (A | MAGIC) & X & Immediate. The "magic" constant varies between
        // CPU revisions ($00, $EE, $FF, etc). Using $FF — the most common value
        // and the only one that passes AccuracyCoin's magic-independent tests.
        // See https://www.nesdev.org/wiki/Programming_with_unofficial_opcodes
        this.REG_ACC = this.F_ZERO =
          (this.REG_ACC | 0xff) & this.REG_X & this.load(addr);
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        break;
      }
      case 77: {
        // *******
        // * LXA * (LAX immediate/ATX)
        // *******

        // A = (A | MAGIC) & Immediate, X = A. Same magic constant issue as ANE.
        // See https://www.nesdev.org/wiki/Programming_with_unofficial_opcodes
        this.REG_ACC =
          this.REG_X =
          this.F_ZERO =
            (this.REG_ACC | 0xff) & this.load(addr);
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        break;
      }

      default: {
        // *******
        // * ??? *
        // *******

        throw new Error(
          `Game crashed, invalid opcode at address $${opaddr.toString(16)}`,
        );
      }
    } // end of switch

    // Step PPU for any internal cycles not covered by bus operations.
    // Some instructions (RTS, RTI, PLA, PLP, JMP indirect) have CPU-internal
    // cycles that don't perform bus reads/writes. Since the PPU is advanced
    // inline (in load/write/push/pull), these internal cycles need explicit
    // PPU stepping to maintain correct total dot count per instruction.
    if (this.instrBusCycles < cycleCount) {
      let missingDots = (cycleCount - this.instrBusCycles) * 3;
      // Update instrBusCycles BEFORE stepping the PPU so that if VBlank
      // fires during this step, nmiRaisedAtCycle correctly reflects the
      // bus cycle these dots belong to. Without this, the NMI delay
      // formula double-counts: (instrBusCycles - nmiRaisedAtCycle) * 3
      // would treat these dots as "future steps" while
      // nmiDotsRemainingInStep already counts remaining dots within them.
      this.instrBusCycles = cycleCount;
      this.nes.ppu.advanceDots(missingDots);
    }

    // NMI delay: when nmiRaised was set during this instruction (by inline
    // PPU stepping triggering VBlank or by a $2000 write enabling NMI),
    // determine 0-delay vs 1-delay based on remaining PPU dots.
    //
    // remainingDots counts PPU dots from the VBlank edge to the end of
    // the instruction. It has two components:
    // 1. Dots from subsequent bus cycles: (instrBusCycles - nmiRaisedAtCycle) * 3
    // 2. Sub-step dots: nmiDotsRemainingInStep (ppu.advanceDots() records
    //    dots - i, which includes the VBlank dot itself)
    //
    // >= 5 remaining dots means the edge propagates in time for the
    // penultimate-cycle poll → 0-delay (nmiImmediate).
    // < 5 remaining dots means 1-delay: leave nmiRaised set, it gets
    // promoted to nmiPending at the start of the NEXT emulate() call.
    //
    // For $2000 writes that enable NMI during VBlank, nmiRaisedAtCycle
    // equals instrBusCycles (last cycle) and nmiDotsRemainingInStep = 0,
    // giving remainingDots = 0 → 1-delay (correct: write always on last
    // bus cycle, NMI fires after next instruction).
    //
    // See https://www.nesdev.org/wiki/CPU_interrupts
    if (this.nmiRaised) {
      let remainingDots =
        (this.instrBusCycles - this.nmiRaisedAtCycle) * 3 +
        this.nmiDotsRemainingInStep;
      if (remainingDots >= 5) {
        // 0-delay: NMI fires before the next instruction.
        this.nmiImmediate = true;
        this.nmiRaised = false;
      }
      // else: 1-delay. nmiRaised stays set for promotion at start of
      // next emulate(), giving standard 1-instruction delay.
    }

    // Fire NMI after the instruction completes. nmiPending comes from
    // promotion of nmiRaised at the start of this emulate() call
    // (edge occurred during the PREVIOUS instruction, 1-delay).
    // See https://www.nesdev.org/wiki/CPU_interrupts
    if (this.nmiPending) {
      this.REG_PC_NEW = this.REG_PC;
      this.F_INTERRUPT_NEW = this.F_INTERRUPT;
      // Clear the B flag (bit 4) for hardware interrupts
      this.doNonMaskableInterrupt(this.getStatus() & 0xef);
      this.REG_PC = this.REG_PC_NEW;
      this.F_INTERRUPT = this.F_INTERRUPT_NEW;
      this.F_BRK = this.F_BRK_NEW;
      this.nmiPending = false;
      interruptCycles = 7;
    }

    this._cpuCycleBase += cycleCount + interruptCycles;
    return cycleCount + interruptCycles;
  }

  // Reads from cartridge ROM, applying any active Game Genie patches.
  // Used for opcode fetches, operand reads, indirect jumps, and interrupt
  // vectors — all places where Game Genie can intercept ROM reads.
  //
  // This method is swapped at runtime via _updateCartridgeLoader() to avoid
  // checking Game Genie state on every ROM read. When no patches are active,
  // it points to _loadFromCartridgePlain (zero overhead). When patches are
  // active, it points to _loadFromCartridgeWithGameGenie.
  loadFromCartridge(addr) {
    return this.nes.mmap.load(addr);
  }

  _loadFromCartridgePlain(addr) {
    return this.nes.mmap.load(addr);
  }

  _loadFromCartridgeWithGameGenie(addr) {
    let value = this.nes.mmap.load(addr);
    return this.nes.gameGenie.applyCodes(addr, value);
  }

  // Swap loadFromCartridge to the appropriate implementation based on
  // whether Game Genie patches are active. Called by GameGenie when
  // patches or enabled state change.
  _updateCartridgeLoader() {
    if (this.nes.gameGenie.enabled && this.nes.gameGenie.patches.length > 0) {
      this.loadFromCartridge = this._loadFromCartridgeWithGameGenie;
    } else {
      // Delete instance property to fall back to the prototype method,
      // which is the plain loader. This keeps the hidden class stable
      // for V8 optimization.
      delete this.loadFromCartridge;
    }
  }

  // Each load() call represents one CPU bus read cycle. After the read,
  // advances the PPU by 3 dots to keep it in sync. APU is clocked in bulk
  // by the frame loop after each instruction.
  //
  // All reads (including PPU registers) use step-after: read first, then
  // advance. This matches the old _ppuCatchUp() behavior where the PPU
  // was advanced by instrBusCycles * 3 dots (completed cycles only, NOT
  // including the current one) before the read. Since prior bus ops have
  // already stepped the PPU, the read sees the same PPU state.
  load(addr) {
    if (addr < 0x2000) {
      // RAM (zero page, stack, general): most common path
      this.dataBus = this.mem[addr & 0x7ff];
      this.instrBusCycles++;
      this.nes.ppu.advanceDots(3);
    } else if (addr >= 0x4000) {
      // Cartridge ROM/RAM, APU, expansion ($4000+)
      if (addr === 0x4015) {
        // APU catch-up: advance frame counter before $4015 read so it sees
        // up-to-date length counter status and IRQ flags.
        this.nes.papu.advanceFrameCounter(
          this.instrBusCycles - this.apuCatchupCycles,
        );
        this.apuCatchupCycles = this.instrBusCycles;
        // $4015 reads are internal to the 2A03 — the APU status value does
        // not drive the external data bus. Return the status directly without
        // updating dataBus, so open bus reads after $4015 still see the
        // previous bus value. See https://www.nesdev.org/wiki/Open_bus_behavior
        let apuStatus = this.loadFromCartridge(addr);
        this.instrBusCycles++;
        this.nes.ppu.advanceDots(3);
        return apuStatus;
      }
      this.dataBus = this.loadFromCartridge(addr);
      this.instrBusCycles++;
      this.nes.ppu.advanceDots(3);
    } else {
      // PPU registers ($2000-$3FFF): increment bus cycle counter first
      // (for correct nmiRaisedAtCycle tracking), then read, then step PPU.
      // The read sees PPU state after all prior bus cycles' dots have been
      // stepped (but NOT the current cycle's dots), matching the old
      // _ppuCatchUp() behavior.
      this.instrBusCycles++;
      this.dataBus = this.loadFromCartridge(addr);
      this.nes.ppu.advanceDots(3);
    }
    return this.dataBus;
  }

  // Fast load for addresses guaranteed to be outside the PPU register range
  // ($2000-$3FFF) and APU status register ($4015). Still updates dataBus
  // (open bus behavior) and advances PPU/APU inline.
  //
  // Safe for:
  //   - Zero-page reads ($00-$FF): always internal RAM
  //   - Program-space operand reads (opaddr+2/+3): always PRG ROM ($8000+)
  //
  // NOT safe for arbitrary effective addresses that could be PPU/APU I/O.
  loadDirect(addr) {
    if (addr < 0x2000) {
      this.dataBus = this.mem[addr & 0x7ff];
    } else {
      this.dataBus = this.loadFromCartridge(addr);
    }
    this.instrBusCycles++;
    this.nes.ppu.advanceDots(3);
    return this.dataBus;
  }

  // Reads a 16-bit value as two separate bus operations with PPU/APU
  // stepping between them, matching the real 6502's two-cycle read.
  load16bit(addr) {
    let lo;
    if (addr < 0x1fff) {
      this.dataBus = this.mem[addr & 0x7ff];
      lo = this.dataBus;
      this.instrBusCycles++;
      this.nes.ppu.advanceDots(3);
      this.dataBus = this.mem[(addr + 1) & 0x7ff];
      this.instrBusCycles++;
      this.nes.ppu.advanceDots(3);
      return lo | (this.dataBus << 8);
    } else {
      this.dataBus = this.loadFromCartridge(addr);
      lo = this.dataBus;
      this.instrBusCycles++;
      this.nes.ppu.advanceDots(3);
      this.dataBus = this.loadFromCartridge(addr + 1);
      this.instrBusCycles++;
      this.nes.ppu.advanceDots(3);
      return lo | (this.dataBus << 8);
    }
  }

  // Each write() call represents one CPU bus write cycle. Write first,
  // then advance PPU by 3 dots. For PPU register writes ($2000-$3FFF),
  // the write takes effect with PPU state from prior cycles' dots (not
  // including current cycle), matching the old _ppuCatchUp() behavior.
  write(addr, val) {
    if (addr >= 0x2000 && addr < 0x4000) {
      // PPU register write: increment bus cycle counter first (so
      // nmiRaisedAtCycle is correct if _updateNmiOutput fires during
      // the write), then write, then step PPU. The write sees PPU state
      // from prior cycles' dots, matching the old _ppuCatchUp() behavior.
      this.instrBusCycles++;
      this.dataBus = val;
      this.nes.mmap.write(addr, val);
      this.nes.ppu.advanceDots(3);
    } else {
      this.dataBus = val;
      if (addr < 0x2000) {
        this.mem[addr & 0x7ff] = val;
      } else {
        this.nes.mmap.write(addr, val);
      }
      this.instrBusCycles++;
      this.nes.ppu.advanceDots(3);
    }
  }

  requestIrq(type) {
    if (this.irqRequested) {
      if (type === this.IRQ_NORMAL) {
        return;
      }
      // console.log("too fast irqs. type="+type);
    }
    this.irqRequested = true;
    this.irqType = type;
  }

  push(value) {
    this.dataBus = value;
    // Stack is always $0100-$01FF (internal RAM), so write directly to mem[]
    // instead of going through the mapper.
    this.mem[this.REG_SP | 0x100] = value;
    this.REG_SP--;
    this.REG_SP = this.REG_SP & 0xff;
    this.instrBusCycles++;
    this.nes.ppu.advanceDots(3);
  }

  pull() {
    this.REG_SP++;
    this.REG_SP = this.REG_SP & 0xff;
    // Stack is always $0100-$01FF (internal RAM), so read directly from mem[].
    this.dataBus = this.mem[0x100 | this.REG_SP];
    this.instrBusCycles++;
    this.nes.ppu.advanceDots(3);
    return this.dataBus;
  }

  // --- DMC DMA bus hijacking ---
  //
  // On real hardware, DMC DMA reads happen mid-instruction: the DMA unit
  // steals a bus cycle to fetch the next sample byte. Normally this is
  // invisible to the CPU, but SHx instructions (SHA/SHX/SHY/SHS) compute
  // their stored value partly from the address bus during an earlier cycle.
  // When a DMA read hijacks the bus between the address setup and the
  // store, the "& (H+1)" factor (derived from the high byte of the base
  // address) is lost. For example, SHY normally stores Y & (H+1), but
  // with a DMA it stores just Y.
  //
  // This emulator can't truly interleave DMA reads with instruction
  // execution (audio is clocked after each instruction in nes.js), so
  // instead we approximate it:
  //
  // 1. At the start of emulate(), snapshot _dmcFetchCycles = how many CPU
  //    cycles until the next DMC DMA fetch (computed by this method).
  //
  // 2. Each SHx instruction case checks whether the DMA would fire during
  //    its bus cycles: _dmcFetchCycles <= instrBusCycles. If so, the
  //    "& (H+1)" factor is dropped from the stored value.
  //
  // 3. Store instructions always perform the indexed dummy read even
  //    without page crossing (unlike loads which skip it), so
  //    instrBusCycles is correct for timing the overlap.
  //
  // 4. The DMC initial load (papu.js ChannelDM.writeReg $4015) triggers
  //    nextSample() immediately when the buffer is empty, matching the
  //    real hardware timing that test ROMs depend on to synchronize their
  //    DMA timing loops (DMASync in AccuracyCoin.asm).
  //
  // Returns a large number (0x7FFFFFFF) if no DMA fetch is pending.
  // See https://www.nesdev.org/wiki/APU_DMC
  _cyclesToNextDmcFetch() {
    if (!this.nes.papu) {
      return 0x7fffffff;
    }
    let dmc = this.nes.papu.dmc;
    if (!dmc || !dmc.isEnabled || dmc.dmaFrequency <= 0) {
      return 0x7fffffff;
    }
    if (!dmc.hasSample) {
      return 0x7fffffff;
    }
    // shiftCounter counts down in units of (nCycles << 3); each tick of
    // clockDmc consumes dmaFrequency units. When dmaCounter reaches 0,
    // endOfSample fires and may call nextSample (the actual DMA fetch).
    // The next DMA fetch occurs when all remaining dmaCounter ticks of
    // the shift register have elapsed, which is:
    //   (remaining shift ticks) / 8 CPU cycles per tick
    // But the first tick fires when shiftCounter reaches 0, so the
    // remaining CPU cycles to the next clockDmc call is ceil(shiftCounter/8).
    // After that, (dmaCounter - 1) more clockDmc calls must fire, each
    // taking dmaFrequency/8 CPU cycles.
    let cyclesPerClock = dmc.dmaFrequency >> 3;
    let cyclesToFirstClock = (dmc.shiftCounter + 7) >> 3;
    if (cyclesToFirstClock <= 0) cyclesToFirstClock = cyclesPerClock;
    return cyclesToFirstClock + (dmc.dmaCounter - 1) * cyclesPerClock;
  }

  // Branch dummy reads: when a branch is taken, the 6502 performs a dummy
  // read from the next sequential instruction address (cycle 3). On a page
  // crossing, it performs an additional dummy read from the "wrong" address
  // where PCH hasn't been fixed yet (cycle 4). These are real bus operations
  // that update the data bus and can trigger I/O side effects.
  // See https://www.nesdev.org/6502_cpu.txt (Relative addressing section)
  _takeBranch(opaddr, addr) {
    // Real addresses (jsnes REG_PC is offset by -1 from real PC)
    let nextPC = (opaddr + 3) & 0xffff; // address of next instruction
    let target = (addr + 1) & 0xffff; // actual branch target

    // Cycle 3: dummy read from next instruction address
    this.load(nextPC);

    if ((nextPC & 0xff00) !== (target & 0xff00)) {
      // Page crossing: cycle 4 dummy read from wrong address (unfixed PCH)
      let wrongAddr = (nextPC & 0xff00) | (target & 0x00ff);
      this.load(wrongAddr);
      this.REG_PC = addr;
      return 2;
    }
    this.REG_PC = addr;
    return 1;
  }

  pageCrossed(addr1, addr2) {
    return (addr1 & 0xff00) !== (addr2 & 0xff00);
  }

  haltCycles(cycles) {
    this.cyclesToHalt += cycles;
  }

  // Interrupt vector fetches update the data bus, just like normal reads.
  // The 3 pushes go through push() which already steps the PPU.
  // The 2 vector reads use loadFromCartridge() directly and need explicit
  // PPU steps. APU is clocked in the frame loop with the returned cycle count.
  doNonMaskableInterrupt(status) {
    if (this.nes.mmap === null) return;

    // Cycles 1-2: internal operations (dummy reads of PC on real hardware).
    // These are real bus cycles that advance the PPU but the read values
    // are discarded. We step the PPU without reading memory to avoid
    // side effects on the data bus.
    // See https://www.nesdev.org/wiki/CPU_interrupts
    this.instrBusCycles++;
    this.nes.ppu.advanceDots(3);
    this.instrBusCycles++;
    this.nes.ppu.advanceDots(3);

    this.REG_PC_NEW++;
    this.push((this.REG_PC_NEW >> 8) & 0xff);
    this.push(this.REG_PC_NEW & 0xff);
    this.F_INTERRUPT_NEW = 1;
    this.push(status);

    this.dataBus = this.loadFromCartridge(0xfffa);
    this.instrBusCycles++;
    this.nes.ppu.advanceDots(3);
    let lo = this.dataBus;
    this.dataBus = this.loadFromCartridge(0xfffb);
    this.instrBusCycles++;
    this.nes.ppu.advanceDots(3);
    this.REG_PC_NEW = lo | (this.dataBus << 8);
    this.REG_PC_NEW--;
  }

  doResetInterrupt() {
    this.dataBus = this.loadFromCartridge(0xfffc);
    this.instrBusCycles++;
    this.nes.ppu.advanceDots(3);
    let lo = this.dataBus;
    this.dataBus = this.loadFromCartridge(0xfffd);
    this.instrBusCycles++;
    this.nes.ppu.advanceDots(3);
    this.REG_PC_NEW = lo | (this.dataBus << 8);
    this.REG_PC_NEW--;
  }

  doIrq(status) {
    this.REG_PC_NEW++;
    this.push((this.REG_PC_NEW >> 8) & 0xff);
    this.push(this.REG_PC_NEW & 0xff);
    this.push(status);
    this.F_INTERRUPT_NEW = 1;
    this.F_BRK_NEW = 0;

    this.dataBus = this.loadFromCartridge(0xfffe);
    this.instrBusCycles++;
    this.nes.ppu.advanceDots(3);
    let lo = this.dataBus;
    this.dataBus = this.loadFromCartridge(0xffff);
    this.instrBusCycles++;
    this.nes.ppu.advanceDots(3);
    this.REG_PC_NEW = lo | (this.dataBus << 8);
    this.REG_PC_NEW--;
  }

  getStatus() {
    // F_ZERO is 0 when the Z flag is set, non-zero when clear (see reset())
    return (
      this.F_CARRY |
      ((this.F_ZERO === 0 ? 1 : 0) << 1) |
      (this.F_INTERRUPT << 2) |
      (this.F_DECIMAL << 3) |
      (this.F_BRK << 4) |
      (this.F_NOTUSED << 5) |
      (this.F_OVERFLOW << 6) |
      (this.F_SIGN << 7)
    );
  }

  setStatus(st) {
    this.F_CARRY = st & 1;
    // F_ZERO uses inverted encoding: 0 means Z is set (see reset())
    this.F_ZERO = ((st >> 1) & 1) === 1 ? 0 : 1;
    this.F_INTERRUPT = (st >> 2) & 1;
    this.F_DECIMAL = (st >> 3) & 1;
    this.F_BRK = (st >> 4) & 1;
    this.F_NOTUSED = (st >> 5) & 1;
    this.F_OVERFLOW = (st >> 6) & 1;
    this.F_SIGN = (st >> 7) & 1;
  }

  // Set status flags from a value pulled off the stack (PLP, RTI).
  // Bits 4 (B) and 5 (unused) don't exist as physical flags in the
  // 6502 and are ignored when pulling status from the stack.
  // See https://www.nesdev.org/wiki/Status_flags#The_B_flag
  setStatusFromStack(st) {
    this.F_CARRY = st & 1;
    this.F_ZERO = ((st >> 1) & 1) === 1 ? 0 : 1;
    this.F_INTERRUPT = (st >> 2) & 1;
    this.F_DECIMAL = (st >> 3) & 1;
    this.F_OVERFLOW = (st >> 6) & 1;
    this.F_SIGN = (st >> 7) & 1;
  }

  static JSON_PROPERTIES = [
    "mem",
    "cyclesToHalt",
    "dataBus",
    "irqRequested",
    "irqType",
    "nmiRaised",
    "nmiPending",
    "nmiImmediate",
    // Registers
    "REG_ACC",
    "REG_X",
    "REG_Y",
    "REG_SP",
    "REG_PC",
    "REG_PC_NEW",
    "REG_STATUS",
    // Status
    "F_CARRY",
    "F_DECIMAL",
    "F_INTERRUPT",
    "F_INTERRUPT_NEW",
    "F_OVERFLOW",
    "F_SIGN",
    "F_ZERO",
    "F_NOTUSED",
    "F_NOTUSED_NEW",
    "F_BRK",
    "F_BRK_NEW",
    "_cpuCycleBase",
  ];

  toJSON() {
    return toJSON(this);
  }

  fromJSON(s) {
    fromJSON(this, s);
  }
}

/* harmony default export */ const cpu = (CPU);

;// ./src/controller.js


class Controller {
  static BUTTON_A = 0;
  static BUTTON_B = 1;
  static BUTTON_SELECT = 2;
  static BUTTON_START = 3;
  static BUTTON_UP = 4;
  static BUTTON_DOWN = 5;
  static BUTTON_LEFT = 6;
  static BUTTON_RIGHT = 7;
  // Turbo buttons rapidly toggle A/B each frame while held, simulating the
  // extra buttons on the NES Advantage and dogbone controllers.
  static BUTTON_TURBO_A = 8;
  static BUTTON_TURBO_B = 9;

  static JSON_PROPERTIES = [
    "state",
    "baseA",
    "baseB",
    "turboA",
    "turboB",
    "turboToggle",
  ];

  constructor() {
    this.state = new Array(8);
    for (let i = 0; i < this.state.length; i++) {
      this.state[i] = 0x40;
    }
    // Track the non-turbo ("base") state of A and B so we can restore them
    // when turbo is released while the regular button is still held.
    this.baseA = 0x40;
    this.baseB = 0x40;
    this.turboA = false;
    this.turboB = false;
    this.turboToggle = false;
  }

  buttonDown(key) {
    if (key === Controller.BUTTON_TURBO_A) {
      this.turboA = true;
    } else if (key === Controller.BUTTON_TURBO_B) {
      this.turboB = true;
    } else {
      this.state[key] = 0x41;
      if (key === Controller.BUTTON_A) this.baseA = 0x41;
      if (key === Controller.BUTTON_B) this.baseB = 0x41;
    }
  }

  buttonUp(key) {
    if (key === Controller.BUTTON_TURBO_A) {
      this.turboA = false;
      this.state[Controller.BUTTON_A] = this.baseA;
    } else if (key === Controller.BUTTON_TURBO_B) {
      this.turboB = false;
      this.state[Controller.BUTTON_B] = this.baseB;
    } else {
      this.state[key] = 0x40;
      if (key === Controller.BUTTON_A) this.baseA = 0x40;
      if (key === Controller.BUTTON_B) this.baseB = 0x40;
    }
  }

  // Called once per frame to toggle turbo button states. Produces a ~30 Hz
  // press rate at 60 FPS, matching the fast end of the NES Advantage's
  // adjustable turbo range.
  clock() {
    if (!this.turboA && !this.turboB) return;
    this.turboToggle = !this.turboToggle;
    if (this.turboA) {
      this.state[Controller.BUTTON_A] = this.turboToggle ? 0x41 : 0x40;
    }
    if (this.turboB) {
      this.state[Controller.BUTTON_B] = this.turboToggle ? 0x41 : 0x40;
    }
  }

  toJSON() {
    return toJSON(this);
  }

  fromJSON(s) {
    fromJSON(this, s);
  }
}

/* harmony default export */ const controller = (Controller);

;// ./src/tile.js
class Tile {
  constructor() {
    // Tile data: color indices 0–3
    this.pix = new Uint8Array(64);

    this.initialized = false;
    this.opaque = new Uint8Array(8);
  }

  setBuffer(scanline) {
    for (let y = 0; y < 8; y++) {
      this.setScanline(y, scanline[y], scanline[y + 8]);
    }
  }

  setScanline(sline, b1, b2) {
    this.initialized = true;
    let tIndex = sline << 3;
    for (let x = 0; x < 8; x++) {
      this.pix[tIndex + x] =
        ((b1 >> (7 - x)) & 1) + (((b2 >> (7 - x)) & 1) << 1);
      if (this.pix[tIndex + x] === 0) {
        this.opaque[sline] = false;
      }
    }
  }

  render(
    buffer,
    srcx1,
    srcy1,
    srcx2,
    srcy2,
    dx,
    dy,
    palAdd,
    palette,
    flipHorizontal,
    flipVertical,
    pri,
    priTable,
  ) {
    if (dx < -7 || dx >= 256 || dy < -7 || dy >= 240) {
      return;
    }

    if (dx < 0) {
      srcx1 -= dx;
    }
    if (dx + srcx2 >= 256) {
      srcx2 = 256 - dx;
    }

    if (dy < 0) {
      srcy1 -= dy;
    }
    if (dy + srcy2 >= 240) {
      srcy2 = 240 - dy;
    }

    let fbIndex, tIndex, palIndex, tpri;

    if (!flipHorizontal && !flipVertical) {
      fbIndex = (dy << 8) + dx;
      tIndex = 0;
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          if (x >= srcx1 && x < srcx2 && y >= srcy1 && y < srcy2) {
            palIndex = this.pix[tIndex];
            tpri = priTable[fbIndex];
            if (palIndex !== 0 && pri <= (tpri & 0xff)) {
              buffer[fbIndex] = palette[palIndex + palAdd];
              tpri = (tpri & 0xf00) | pri;
              priTable[fbIndex] = tpri;
            }
          }
          fbIndex++;
          tIndex++;
        }
        fbIndex -= 8;
        fbIndex += 256;
      }
    } else if (flipHorizontal && !flipVertical) {
      fbIndex = (dy << 8) + dx;
      tIndex = 7;
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          if (x >= srcx1 && x < srcx2 && y >= srcy1 && y < srcy2) {
            palIndex = this.pix[tIndex];
            tpri = priTable[fbIndex];
            if (palIndex !== 0 && pri <= (tpri & 0xff)) {
              buffer[fbIndex] = palette[palIndex + palAdd];
              tpri = (tpri & 0xf00) | pri;
              priTable[fbIndex] = tpri;
            }
          }
          fbIndex++;
          tIndex--;
        }
        fbIndex -= 8;
        fbIndex += 256;
        tIndex += 16;
      }
    } else if (flipVertical && !flipHorizontal) {
      fbIndex = (dy << 8) + dx;
      tIndex = 56;
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          if (x >= srcx1 && x < srcx2 && y >= srcy1 && y < srcy2) {
            palIndex = this.pix[tIndex];
            tpri = priTable[fbIndex];
            if (palIndex !== 0 && pri <= (tpri & 0xff)) {
              buffer[fbIndex] = palette[palIndex + palAdd];
              tpri = (tpri & 0xf00) | pri;
              priTable[fbIndex] = tpri;
            }
          }
          fbIndex++;
          tIndex++;
        }
        fbIndex -= 8;
        fbIndex += 256;
        tIndex -= 16;
      }
    } else {
      fbIndex = (dy << 8) + dx;
      tIndex = 63;
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          if (x >= srcx1 && x < srcx2 && y >= srcy1 && y < srcy2) {
            palIndex = this.pix[tIndex];
            tpri = priTable[fbIndex];
            if (palIndex !== 0 && pri <= (tpri & 0xff)) {
              buffer[fbIndex] = palette[palIndex + palAdd];
              tpri = (tpri & 0xf00) | pri;
              priTable[fbIndex] = tpri;
            }
          }
          fbIndex++;
          tIndex--;
        }
        fbIndex -= 8;
        fbIndex += 256;
      }
    }
  }

  isTransparent(x, y) {
    return this.pix[(y << 3) + x] === 0;
  }

  toJSON() {
    return {
      opaque: Array.from(this.opaque),
      pix: Array.from(this.pix),
    };
  }

  fromJSON(s) {
    this.opaque.set(s.opaque);
    this.pix.set(s.pix);
  }
}

/* harmony default export */ const tile = (Tile);

;// ./src/ppu/nametable.js
class NameTable {
  constructor(width, height, name) {
    this.width = width;
    this.height = height;
    this.name = name;

    this.tile = new Uint8Array(width * height);
    this.attrib = new Uint8Array(width * height);
  }

  getTileIndex(x, y) {
    return this.tile[y * this.width + x];
  }

  getAttrib(x, y) {
    return this.attrib[y * this.width + x];
  }

  writeAttrib(index, value) {
    let basex = (index % 8) * 4;
    let basey = Math.floor(index / 8) * 4;
    let add;
    let tx, ty;
    let attindex;

    for (let sqy = 0; sqy < 2; sqy++) {
      for (let sqx = 0; sqx < 2; sqx++) {
        add = (value >> (2 * (sqy * 2 + sqx))) & 3;
        for (let y = 0; y < 2; y++) {
          for (let x = 0; x < 2; x++) {
            tx = basex + sqx * 2 + x;
            ty = basey + sqy * 2 + y;
            attindex = ty * this.width + tx;
            this.attrib[attindex] = (add << 2) & 12;
          }
        }
      }
    }
  }

  toJSON() {
    return {
      tile: Array.from(this.tile),
      attrib: Array.from(this.attrib),
    };
  }

  fromJSON(s) {
    this.tile.set(s.tile);
    this.attrib.set(s.attrib);
  }
}

/* harmony default export */ const nametable = (NameTable);

;// ./src/ppu/palette-table.js
class PaletteTable {
  constructor() {
    this.curTable = new Uint32Array(64);
    this.emphTable = new Array(8);
    this.currentEmph = -1;
  }

  loadNTSCPalette() {
    // prettier-ignore
    this.curTable = new Uint32Array([0x525252, 0xB40000, 0xA00000, 0xB1003D, 0x740069, 0x00005B, 0x00005F, 0x001840, 0x002F10, 0x084A08, 0x006700, 0x124200, 0x6D2800, 0x000000, 0x000000, 0x000000, 0xC4D5E7, 0xFF4000, 0xDC0E22, 0xFF476B, 0xD7009F, 0x680AD7, 0x0019BC, 0x0054B1, 0x006A5B, 0x008C03, 0x00AB00, 0x2C8800, 0xA47200, 0x000000, 0x000000, 0x000000, 0xF8F8F8, 0xFFAB3C, 0xFF7981, 0xFF5BC5, 0xFF48F2, 0xDF49FF, 0x476DFF, 0x00B4F7, 0x00E0FF, 0x00E375, 0x03F42B, 0x78B82E, 0xE5E218, 0x787878, 0x000000, 0x000000, 0xFFFFFF, 0xFFF2BE, 0xF8B8B8, 0xF8B8D8, 0xFFB6FF, 0xFFC3FF, 0xC7D1FF, 0x9ADAFF, 0x88EDF8, 0x83FFDD, 0xB8F8B8, 0xF5F8AC, 0xFFFFB0, 0xF8D8F8, 0x000000, 0x000000]);
    this.makeTables();
    this.setEmphasis(0);
  }

  loadPALPalette() {
    // prettier-ignore
    this.curTable = new Uint32Array([0x525252, 0xB40000, 0xA00000, 0xB1003D, 0x740069, 0x00005B, 0x00005F, 0x001840, 0x002F10, 0x084A08, 0x006700, 0x124200, 0x6D2800, 0x000000, 0x000000, 0x000000, 0xC4D5E7, 0xFF4000, 0xDC0E22, 0xFF476B, 0xD7009F, 0x680AD7, 0x0019BC, 0x0054B1, 0x006A5B, 0x008C03, 0x00AB00, 0x2C8800, 0xA47200, 0x000000, 0x000000, 0x000000, 0xF8F8F8, 0xFFAB3C, 0xFF7981, 0xFF5BC5, 0xFF48F2, 0xDF49FF, 0x476DFF, 0x00B4F7, 0x00E0FF, 0x00E375, 0x03F42B, 0x78B82E, 0xE5E218, 0x787878, 0x000000, 0x000000, 0xFFFFFF, 0xFFF2BE, 0xF8B8B8, 0xF8B8D8, 0xFFB6FF, 0xFFC3FF, 0xC7D1FF, 0x9ADAFF, 0x88EDF8, 0x83FFDD, 0xB8F8B8, 0xF5F8AC, 0xFFFFB0, 0xF8D8F8, 0x000000, 0x000000]);
    this.makeTables();
    this.setEmphasis(0);
  }

  makeTables() {
    let r, g, b, col, i, rFactor, gFactor, bFactor;

    // Calculate a table for each possible emphasis setting:
    for (let emph = 0; emph < 8; emph++) {
      // Determine color component factors:
      rFactor = 1.0;
      gFactor = 1.0;
      bFactor = 1.0;

      // NTSC emphasis bits from $2001:
      // Bit 5 (emph & 1): Emphasize Red → darken Green + Blue
      // Bit 6 (emph & 2): Emphasize Green → darken Red + Blue
      // Bit 7 (emph & 4): Emphasize Blue → darken Red + Green
      // See https://www.nesdev.org/wiki/PPU_registers#Color_emphasis
      if ((emph & 1) !== 0) {
        gFactor = 0.75;
        bFactor = 0.75;
      }
      if ((emph & 2) !== 0) {
        rFactor = 0.75;
        bFactor = 0.75;
      }
      if ((emph & 4) !== 0) {
        rFactor = 0.75;
        gFactor = 0.75;
      }

      this.emphTable[emph] = new Uint32Array(64);

      // Calculate table:
      for (i = 0; i < 64; i++) {
        col = this.curTable[i];
        r = Math.floor(this.getRed(col) * rFactor);
        g = Math.floor(this.getGreen(col) * gFactor);
        b = Math.floor(this.getBlue(col) * bFactor);
        this.emphTable[emph][i] = this.getRgb(r, g, b);
      }
    }
  }

  setEmphasis(emph) {
    if (emph !== this.currentEmph) {
      this.currentEmph = emph;
      for (let i = 0; i < 64; i++) {
        this.curTable[i] = this.emphTable[emph][i];
      }
    }
  }

  getEntry(yiq) {
    return this.curTable[yiq];
  }

  getRed(rgb) {
    return (rgb >> 16) & 0xff;
  }

  getGreen(rgb) {
    return (rgb >> 8) & 0xff;
  }

  getBlue(rgb) {
    return rgb & 0xff;
  }

  getRgb(r, g, b) {
    return (r << 16) | (g << 8) | b;
  }

  loadDefaultPalette() {
    this.curTable[0] = this.getRgb(117, 117, 117);
    this.curTable[1] = this.getRgb(39, 27, 143);
    this.curTable[2] = this.getRgb(0, 0, 171);
    this.curTable[3] = this.getRgb(71, 0, 159);
    this.curTable[4] = this.getRgb(143, 0, 119);
    this.curTable[5] = this.getRgb(171, 0, 19);
    this.curTable[6] = this.getRgb(167, 0, 0);
    this.curTable[7] = this.getRgb(127, 11, 0);
    this.curTable[8] = this.getRgb(67, 47, 0);
    this.curTable[9] = this.getRgb(0, 71, 0);
    this.curTable[10] = this.getRgb(0, 81, 0);
    this.curTable[11] = this.getRgb(0, 63, 23);
    this.curTable[12] = this.getRgb(27, 63, 95);
    this.curTable[13] = this.getRgb(0, 0, 0);
    this.curTable[14] = this.getRgb(0, 0, 0);
    this.curTable[15] = this.getRgb(0, 0, 0);
    this.curTable[16] = this.getRgb(188, 188, 188);
    this.curTable[17] = this.getRgb(0, 115, 239);
    this.curTable[18] = this.getRgb(35, 59, 239);
    this.curTable[19] = this.getRgb(131, 0, 243);
    this.curTable[20] = this.getRgb(191, 0, 191);
    this.curTable[21] = this.getRgb(231, 0, 91);
    this.curTable[22] = this.getRgb(219, 43, 0);
    this.curTable[23] = this.getRgb(203, 79, 15);
    this.curTable[24] = this.getRgb(139, 115, 0);
    this.curTable[25] = this.getRgb(0, 151, 0);
    this.curTable[26] = this.getRgb(0, 171, 0);
    this.curTable[27] = this.getRgb(0, 147, 59);
    this.curTable[28] = this.getRgb(0, 131, 139);
    this.curTable[29] = this.getRgb(0, 0, 0);
    this.curTable[30] = this.getRgb(0, 0, 0);
    this.curTable[31] = this.getRgb(0, 0, 0);
    this.curTable[32] = this.getRgb(255, 255, 255);
    this.curTable[33] = this.getRgb(63, 191, 255);
    this.curTable[34] = this.getRgb(95, 151, 255);
    this.curTable[35] = this.getRgb(167, 139, 253);
    this.curTable[36] = this.getRgb(247, 123, 255);
    this.curTable[37] = this.getRgb(255, 119, 183);
    this.curTable[38] = this.getRgb(255, 119, 99);
    this.curTable[39] = this.getRgb(255, 155, 59);
    this.curTable[40] = this.getRgb(243, 191, 63);
    this.curTable[41] = this.getRgb(131, 211, 19);
    this.curTable[42] = this.getRgb(79, 223, 75);
    this.curTable[43] = this.getRgb(88, 248, 152);
    this.curTable[44] = this.getRgb(0, 235, 219);
    this.curTable[45] = this.getRgb(0, 0, 0);
    this.curTable[46] = this.getRgb(0, 0, 0);
    this.curTable[47] = this.getRgb(0, 0, 0);
    this.curTable[48] = this.getRgb(255, 255, 255);
    this.curTable[49] = this.getRgb(171, 231, 255);
    this.curTable[50] = this.getRgb(199, 215, 255);
    this.curTable[51] = this.getRgb(215, 203, 255);
    this.curTable[52] = this.getRgb(255, 199, 255);
    this.curTable[53] = this.getRgb(255, 199, 219);
    this.curTable[54] = this.getRgb(255, 191, 179);
    this.curTable[55] = this.getRgb(255, 219, 171);
    this.curTable[56] = this.getRgb(255, 231, 163);
    this.curTable[57] = this.getRgb(227, 255, 163);
    this.curTable[58] = this.getRgb(171, 243, 191);
    this.curTable[59] = this.getRgb(179, 255, 207);
    this.curTable[60] = this.getRgb(159, 255, 243);
    this.curTable[61] = this.getRgb(0, 0, 0);
    this.curTable[62] = this.getRgb(0, 0, 0);
    this.curTable[63] = this.getRgb(0, 0, 0);

    this.makeTables();
    this.setEmphasis(0);
  }
}

/* harmony default export */ const palette_table = (PaletteTable);

;// ./src/ppu/index.js





class PPU {
  // Status flags:
  STATUS_VRAMWRITE = 4;
  STATUS_SLSPRITECOUNT = 5;
  STATUS_SPRITE0HIT = 6;
  STATUS_VBLANK = 7;

  constructor(nes) {
    this.nes = nes;

    // Rendering Options:
    this.showSpr0Hit = false;
    this.clipToTvSize = true;

    let i;

    // Memory (Uint8Array is zero-initialized)
    this.vramMem = new Uint8Array(0x8000);
    this.spriteMem = new Uint8Array(0x100);

    // VRAM I/O:
    this.vramAddress = null;
    this.vramTmpAddress = null;
    this.vramBufferedReadValue = 0;
    this.firstWrite = true; // VRAM/Scroll Hi/Lo latch
    // PPU has its own internal I/O bus. All PPU register writes update this
    // latch. Reading write-only registers ($2000,$2001,$2003,$2005,$2006)
    // returns this value. $2002 uses bits 4-0 from this latch.
    // On real hardware the latch decays to 0 per-bit after ~600ms.
    this.openBusLatch = 0;
    this.openBusDecayFrames = 0;

    // SPR-RAM I/O:
    this.sramAddress = 0; // 8-bit only.

    this.currentMirroring = -1;
    // NMI edge detection state. On real hardware, /NMI is level-sensitive but
    // the PPU only asserts it on a rising edge: when (vblankFlag AND nmiEnabled)
    // transitions from false to true. See https://www.nesdev.org/wiki/NMI
    this.nmiOutput = false; // Current NMI output level
    this.nmiSuppressed = false; // Suppresses VBlank set when $2002 read at dot 0
    // Set by endScanline(261) to indicate that a full frame has been rendered
    // and VBlank should fire at dot 1 of scanline 0. Prevents premature VBlank
    // on the first frame when the PPU starts at scanline 0.
    this.vblankPending = false;
    // Set by step() when VBlank fires, signals frame loop to break.
    this.frameEnded = false;
    this.dummyCycleToggle = false;
    this.validTileData = false;
    this.scanlineAlreadyRendered = null;

    // Control Flags Register 1:
    this.f_nmiOnVblank = 0; // NMI on VBlank. 0=disable, 1=enable
    this.f_spriteSize = 0; // Sprite size. 0=8x8, 1=8x16
    this.f_bgPatternTable = 0; // Background Pattern Table address. 0=0x0000,1=0x1000
    this.f_spPatternTable = 0; // Sprite Pattern Table address. 0=0x0000,1=0x1000
    this.f_addrInc = 0; // PPU Address Increment. 0=1,1=32
    this.f_nTblAddress = 0; // Name Table Address. 0=0x2000,1=0x2400,2=0x2800,3=0x2C00

    // Control Flags Register 2:
    this.f_color = 0; // Background color. 0=black, 1=blue, 2=green, 4=red
    this.f_spVisibility = 0; // Sprite visibility. 0=not displayed,1=displayed
    this.f_bgVisibility = 0; // Background visibility. 0=Not Displayed,1=displayed
    this.f_spClipping = 0; // Sprite clipping. 0=Sprites invisible in left 8-pixel column,1=No clipping
    this.f_bgClipping = 0; // Background clipping. 0=BG invisible in left 8-pixel column, 1=No clipping
    this.f_dispType = 0; // Display type. 0=color, 1=monochrome

    // Counters:
    this.cntFV = 0;
    this.cntV = 0;
    this.cntH = 0;
    this.cntVT = 0;
    this.cntHT = 0;

    // Registers:
    this.regFV = 0;
    this.regV = 0;
    this.regH = 0;
    this.regVT = 0;
    this.regHT = 0;
    this.regFH = 0;
    this.regS = 0;

    // These are temporary variables used in rendering and sound procedures.
    // Their states outside of those procedures can be ignored.
    // TODO: the use of this is a bit weird, investigate
    this.curNt = null;

    // Variables used when rendering:
    this.attrib = new Uint8Array(32);
    this.buffer = new Uint32Array(256 * 240);
    this.bgbuffer = new Uint32Array(256 * 240);
    this.pixrendered = new Uint32Array(256 * 240);

    this.validTileData = null;

    this.scantile = new Array(32);

    // Initialize misc vars:
    this.scanline = 0;
    this.lastRenderedScanline = -1;
    this.curX = 0;

    // Sprite data (unpacked from primary OAM for quick access):
    this.sprX = new Uint8Array(64); // X coordinate
    this.sprY = new Uint8Array(64); // Y coordinate
    this.sprTile = new Uint8Array(64); // Tile Index (into pattern table)
    this.sprCol = new Uint8Array(64); // Upper two bits of color
    this.vertFlip = new Uint8Array(64); // Vertical Flip (0/1)
    this.horiFlip = new Uint8Array(64); // Horizontal Flip (0/1)
    this.bgPriority = new Uint8Array(64); // Background priority (0/1)
    this.spr0HitX = 0; // Sprite #0 hit X coordinate
    this.spr0HitY = 0; // Sprite #0 hit Y coordinate
    this.hitSpr0 = false;

    // Secondary OAM: 32 bytes (8 sprites × 4 bytes each).
    // On real hardware, the PPU evaluates sprites during cycles 65-256 of each
    // visible scanline, copying in-range sprites into this buffer. Only these
    // sprites (max 8) are rendered on the next scanline.
    // This buffer persists across scanlines — it is NOT cleared on the
    // pre-render scanline, so stale data from the last evaluation can cause
    // sprites to appear on NES scanline 0.
    // See https://www.nesdev.org/wiki/PPU_sprite_evaluation
    this.secondaryOAM = new Uint8Array(32);
    this.secondaryOAM.fill(0xff); // $FF = no valid sprites (matches hardware clear)
    // How many sprites were found during the last evaluation (0-8).
    this.spritesFound = 0;
    // Whether sprite 0 (relative to OAMADDR) was in the last evaluation.
    // This determines whether sprite 0 hit detection is active.
    this.sprite0InSecondary = false;

    // Per-scanline sprite evaluation results. Evaluation on visible scanline N
    // determines which sprites appear on scanline N+1. Because jsnes uses
    // batched/lazy sprite rendering, we store results per scanline so the
    // renderer can look them up when it runs later.
    // See https://www.nesdev.org/wiki/PPU_sprite_evaluation
    //
    // Storage layout: 240 scanlines × up to 8 sprites × 4 bytes = flat arrays.
    this.scanlineSpriteCount = new Uint8Array(241); // +1 for buffer
    this.scanlineSecondaryOAM = new Uint8Array(241 * 32);
    this.scanlineSprite0 = new Uint8Array(241); // 1 if sprite 0 present

    // Palette data:
    this.sprPalette = new Uint32Array(16);
    this.imgPalette = new Uint32Array(16);

    // Create pattern table tile buffers:
    this.ptTile = new Array(512);
    for (i = 0; i < 512; i++) {
      this.ptTile[i] = new tile();
    }

    // Create nametable buffers:
    // Name table data:
    this.ntable1 = new Array(4);
    this.currentMirroring = -1;
    this.nameTable = new Array(4);
    for (i = 0; i < 4; i++) {
      this.nameTable[i] = new nametable(32, 32, `Nt${i}`);
    }

    // Initialize mirroring lookup table:
    this.vramMirrorTable = new Uint16Array(0x8000);
    for (i = 0; i < 0x8000; i++) {
      this.vramMirrorTable[i] = i;
    }

    this.palTable = new palette_table();
    this.palTable.loadNTSCPalette();
    //this.palTable.loadDefaultPalette();

    this.updateControlReg1(0);
    this.updateControlReg2(0);
  }

  // Sets Nametable mirroring.
  setMirroring(mirroring) {
    if (mirroring === this.currentMirroring) {
      return;
    }

    this.currentMirroring = mirroring;
    this.triggerRendering();

    // Remove mirroring:
    if (this.vramMirrorTable === null) {
      this.vramMirrorTable = new Uint16Array(0x8000);
    }
    for (let i = 0; i < 0x8000; i++) {
      this.vramMirrorTable[i] = i;
    }

    // Palette mirroring:
    this.defineMirrorRegion(0x3f20, 0x3f00, 0x20);
    this.defineMirrorRegion(0x3f40, 0x3f00, 0x20);
    this.defineMirrorRegion(0x3f80, 0x3f00, 0x20);
    this.defineMirrorRegion(0x3fc0, 0x3f00, 0x20);

    // Additional mirroring:
    this.defineMirrorRegion(0x3000, 0x2000, 0xf00);
    this.defineMirrorRegion(0x4000, 0x0000, 0x4000);

    if (mirroring === this.nes.rom.HORIZONTAL_MIRRORING) {
      // Horizontal mirroring.

      this.ntable1[0] = 0;
      this.ntable1[1] = 0;
      this.ntable1[2] = 1;
      this.ntable1[3] = 1;

      this.defineMirrorRegion(0x2400, 0x2000, 0x400);
      this.defineMirrorRegion(0x2c00, 0x2800, 0x400);
    } else if (mirroring === this.nes.rom.VERTICAL_MIRRORING) {
      // Vertical mirroring.

      this.ntable1[0] = 0;
      this.ntable1[1] = 1;
      this.ntable1[2] = 0;
      this.ntable1[3] = 1;

      this.defineMirrorRegion(0x2800, 0x2000, 0x400);
      this.defineMirrorRegion(0x2c00, 0x2400, 0x400);
    } else if (mirroring === this.nes.rom.SINGLESCREEN_MIRRORING) {
      // Single Screen mirroring

      this.ntable1[0] = 0;
      this.ntable1[1] = 0;
      this.ntable1[2] = 0;
      this.ntable1[3] = 0;

      this.defineMirrorRegion(0x2400, 0x2000, 0x400);
      this.defineMirrorRegion(0x2800, 0x2000, 0x400);
      this.defineMirrorRegion(0x2c00, 0x2000, 0x400);
    } else if (mirroring === this.nes.rom.SINGLESCREEN_MIRRORING2) {
      this.ntable1[0] = 1;
      this.ntable1[1] = 1;
      this.ntable1[2] = 1;
      this.ntable1[3] = 1;

      this.defineMirrorRegion(0x2400, 0x2400, 0x400);
      this.defineMirrorRegion(0x2800, 0x2400, 0x400);
      this.defineMirrorRegion(0x2c00, 0x2400, 0x400);
    } else {
      // Assume Four-screen mirroring.

      this.ntable1[0] = 0;
      this.ntable1[1] = 1;
      this.ntable1[2] = 2;
      this.ntable1[3] = 3;
    }
  }

  // Define a mirrored area in the address lookup table.
  // Assumes the regions don't overlap.
  // The 'to' region is the region that is physically in memory.
  defineMirrorRegion(fromStart, toStart, size) {
    for (let i = 0; i < size; i++) {
      this.vramMirrorTable[fromStart + i] = toStart + i;
    }
  }

  startVBlank() {
    // NMI is now handled by _updateNmiOutput() edge detection — the VBlank
    // flag is set at dot 1 of scanline 0 in the frame/catch-up loops, which
    // call _updateNmiOutput() to fire NMI on the rising edge.

    // PPU open bus latch decay: on real hardware each bit decays to 0
    // after ~600ms (~36 frames). We use a simple per-latch frame counter.
    if (this.openBusDecayFrames > 0) {
      this.openBusDecayFrames--;
      if (this.openBusDecayFrames === 0) {
        this.openBusLatch = 0;
      }
    }

    // Make sure everything is rendered:
    if (this.lastRenderedScanline < 239) {
      this.renderFramePartially(
        this.lastRenderedScanline + 1,
        240 - this.lastRenderedScanline,
      );
    }

    // End frame:
    this.endFrame();

    // Reset scanline counter:
    this.lastRenderedScanline = -1;
  }

  // Fire the VBlank set event at dot 1 of scanline 0 (NES scanline 241).
  // dotsRemaining is the number of dots left in the current advanceDots()
  // call (including the VBlank dot), used for NMI delay calculation.
  // 0 means VBlank fires at the boundary between steps.
  _fireVblankSet(cpu, dotsRemaining) {
    this.vblankPending = false;
    if (!this.nmiSuppressed) {
      this.setStatusFlag(this.STATUS_VBLANK, true);
      this._updateNmiOutput();
      if (cpu.nmiRaised) {
        cpu.nmiDotsRemainingInStep = dotsRemaining;
      }
    }
    this.nmiSuppressed = false;
    this.startVBlank();
    this.frameEnded = true;
  }

  // Fire the VBlank clear event at dot 1 of scanline 20 (NES scanline 261,
  // pre-render). isLastDot indicates whether this is the last dot of the
  // current advanceDots() call. The 6502's NMI edge detector samples at φ2
  // (~2/3 through the bus cycle), so we only promote nmiRaised to nmiPending
  // when φ2 has had time to sample the rising edge — i.e., on the last dot.
  // See https://www.nesdev.org/wiki/NMI
  _fireVblankClear(cpu, isLastDot) {
    if (cpu.nmiRaised && isLastDot) {
      cpu.nmiPending = true;
      cpu.nmiRaised = false;
    }
    this.setStatusFlag(this.STATUS_VBLANK, false);
    this.setStatusFlag(this.STATUS_SPRITE0HIT, false);
    // Sprite overflow flag is cleared at the same time as VBlank and
    // sprite 0 hit, at dot 1 of the pre-render scanline.
    // See https://www.nesdev.org/wiki/PPU_registers#PPUSTATUS
    this.setStatusFlag(this.STATUS_SLSPRITECOUNT, false);
    this.hitSpr0 = false;
    this.spr0HitX = -1;
    this.spr0HitY = -1;
    this._updateNmiOutput();
  }

  // Advance the PPU by the given number of dots. Called after every CPU bus
  // cycle with dots=3 (PPU runs at 3x CPU clock). Handles all per-dot events:
  // VBlank set/clear, sprite 0 hit, and scanline boundaries.
  //
  // Sets this.frameEnded = true when VBlank fires (scanline 0, dot 1),
  // signaling the frame loop to break after the current instruction.
  advanceDots(dots) {
    let finalCurX = this.curX + dots;

    // Fast path: skip dot-by-dot when no per-dot events can fire.
    // This handles ~99% of calls since VBlank, sprite 0, and scanline
    // boundaries are rare relative to total dots per frame.
    if (
      finalCurX < 341 &&
      !(
        this.scanline === 0 &&
        this.vblankPending &&
        this.curX <= 1 &&
        finalCurX >= 1
      ) &&
      !(this.scanline === 20 && this.curX <= 1 && finalCurX >= 1) &&
      (this.spr0HitX < this.curX || this.spr0HitX >= finalCurX)
    ) {
      this.curX = finalCurX;
      return;
    }

    // Slow path: advance dot-by-dot checking for events.
    let cpu = this.nes.cpu;
    for (let i = 0; i < dots; i++) {
      // VBlank set at dot 1 of scanline 0 (NES scanline 241).
      if (this.scanline === 0 && this.curX === 1 && this.vblankPending) {
        this._fireVblankSet(cpu, dots - i);
        this.curX++;
        continue;
      }

      // VBlank clear at dot 1 of scanline 20 (NES scanline 261, pre-render).
      if (this.scanline === 20 && this.curX === 1) {
        this._fireVblankClear(cpu, i === dots - 1);
      }

      // Sprite 0 hit check. On real hardware, sprite 0 hit requires BOTH
      // background and sprite rendering to be enabled at the hit dot.
      // See https://www.nesdev.org/wiki/PPU_OAM#Sprite_zero_hits
      if (
        this.curX === this.spr0HitX &&
        this.f_bgVisibility === 1 &&
        this.f_spVisibility === 1 &&
        this.scanline - 21 === this.spr0HitY
      ) {
        this.setStatusFlag(this.STATUS_SPRITE0HIT, true);
      }

      this.curX++;
      if (this.curX === 341) {
        this.curX = 0;
        this.endScanline();
      }
    }

    // Post-loop boundary checks: if curX landed on a VBlank or VBlank-clear
    // dot after the loop exhausted all dots, fire the event now. This handles
    // the case where the last iteration incremented curX to 1 but the loop
    // exited before the VBlank check could run at the START of the next
    // iteration. On real hardware, VBL is set at the START of dot 1, so
    // reads at that dot must see the updated state.
    // See https://www.nesdev.org/wiki/PPU_frame_timing
    if (this.scanline === 0 && this.curX === 1 && this.vblankPending) {
      this._fireVblankSet(cpu, 0);
    }
    if (this.scanline === 20 && this.curX === 1) {
      // isLastDot=true: the loop exhausted all dots so φ2 has sampled.
      this._fireVblankClear(cpu, true);
    }
  }

  endScanline() {
    switch (this.scanline) {
      case 19:
        // Dummy scanline.
        // May be variable length:
        if (this.dummyCycleToggle) {
          // Remove dead cycle at end of scanline,
          // for next scanline:
          this.curX = 1;
          this.dummyCycleToggle = !this.dummyCycleToggle;
        }
        break;

      case 20:
        // Pre-render scanline (NES scanline 261). VBlank and sprite 0 hit
        // flags are cleared at dot 1, handled by the frame loop and catch-up
        // loop for cycle-accurate timing.

        // OAM corruption: if OAMADDR != 0 at the beginning of the pre-render
        // scanline, the 8 bytes at (OAMADDR & $F8) overwrite OAM[0..7].
        // This happens BEFORE the OAMADDR reset at cycles 257-320.
        // See https://www.nesdev.org/wiki/PPU_OAM#Sprite_0_corruption
        this.performOAMCorruption();

        if (this.f_bgVisibility === 1 || this.f_spVisibility === 1) {
          // Update counters:
          this.cntFV = this.regFV;
          this.cntV = this.regV;
          this.cntH = this.regH;
          this.cntVT = this.regVT;
          this.cntHT = this.regHT;

          // On real hardware, the PPU runs a unified rendering pipeline
          // whenever either BG or sprites is enabled. BG tile fetches and
          // shift register loading happen regardless of which specific layer
          // flag is set. The individual visibility flags only affect the
          // final pixel output stage.
          // See https://www.nesdev.org/wiki/PPU_rendering
          if (this.f_bgVisibility === 1 || this.f_spVisibility === 1) {
            // Render dummy scanline:
            this.renderBgScanline(false, 0);
          }

          // Sprite evaluation does NOT happen on the pre-render scanline, and
          // secondary OAM is NOT cleared either. The pre-render scanline's sprite
          // tile loading (cycles 257-320) reads from the stale secondary OAM left
          // over from the last visible scanline's evaluation. If any stale sprites
          // happen to be at Y=0, they will render on NES scanline 0.
          // See https://www.nesdev.org/wiki/PPU_sprite_evaluation
          //
          // Buffer row 0 is the pre-render dummy row (no sprites).
          this.scanlineSpriteCount[0] = 0;
          this.scanlineSprite0[0] = 0;
          for (let i = 0; i < 32; i++) {
            this.scanlineSecondaryOAM[i] = 0xff;
          }

          // Buffer row 1 = NES scanline 0. Copy stale secondary OAM data from
          // the last evaluation (preserved in this.secondaryOAM). On real hardware,
          // the secondary OAM register persists and the pre-render scanline doesn't
          // clear it, allowing stale sprites to appear on scanline 0.
          // See AccuracyCoin "Sprites on Scanline 0" test.
          let scanline0Base = 1 * 32;
          for (let i = 0; i < 32; i++) {
            this.scanlineSecondaryOAM[scanline0Base + i] = this.secondaryOAM[i];
          }
          this.scanlineSpriteCount[1] = this.spritesFound;
          this.scanlineSprite0[1] = this.sprite0InSecondary ? 1 : 0;

          // OAMADDR is reset to 0 during sprite tile loading (cycles 257-320).
          this.sramAddress = 0;
        }

        if (this.f_bgVisibility === 1 && this.f_spVisibility === 1) {
          // Check sprite 0 hit for dummy scanline (buffer row 0).
          this.checkSprite0(0);
        }

        // Pre-compute sprite 0 hit for the first visible scanline (buffer
        // row 1). The dummy render above advanced the scroll counters to point
        // at row 1's vertical position, and the secondary OAM for row 1 was
        // set up from stale data above. This allows the dot-by-dot loop in
        // step() to detect the hit at the correct PPU dot during scanline 21.
        if (
          !this.hitSpr0 &&
          this.f_bgVisibility === 1 &&
          this.f_spVisibility === 1
        ) {
          if (this._precomputeSprite0Hit(1)) {
            this.hitSpr0 = true;
          }
        }

        if (this.f_bgVisibility === 1 || this.f_spVisibility === 1) {
          // Clock mapper IRQ Counter:
          this.nes.mmap.clockIrqCounter();
        }
        break;

      case 261:
        // Post-render scanline (NES scanline 240), no rendering.
        // VBlank flag is set at dot 1 of the NEXT scanline (scanline 0 / NES 241)
        // by the frame loop and catch-up loop, gated on vblankPending.
        this.vblankPending = true;

        // Wrap around:
        this.scanline = -1; // will be incremented to 0

        break;

      default:
        if (this.scanline >= 21 && this.scanline <= 260) {
          // NES visible scanline index (0-239). The PPU's internal scanline
          // counter starts at 0 for VBlank, 20 for pre-render, 21 for the
          // first visible scanline. The buffer row is scanline - 20 (1-240),
          // offset by 1 because the pre-render scanline renders row 0.
          let bufferScan = this.scanline + 1 - 21;

          // OAM corruption at the start of each visible scanline.
          // Normally OAMADDR is 0 here (reset by evaluation on the previous
          // scanline), but writes to $2003 during rendering can trigger this.
          this.performOAMCorruption();

          // Render normally. On real hardware the PPU runs a unified
          // rendering pipeline when either BG or sprites is enabled — BG
          // tile fetches, shift register loading, and VRAM address
          // increments all happen regardless of which layer flag is set.
          // The individual visibility flags only suppress the final pixel
          // output. We must always populate bgbuffer/pixrendered so that
          // sprite 0 hit detection works even when BG was briefly disabled.
          // See https://www.nesdev.org/wiki/PPU_rendering
          if (this.f_bgVisibility === 1 || this.f_spVisibility === 1) {
            if (!this.scanlineAlreadyRendered) {
              // update scroll:
              this.cntHT = this.regHT;
              this.cntH = this.regH;
              this.renderBgScanline(true, bufferScan);
            }
            this.scanlineAlreadyRendered = false;

            // Check for sprite 0 hit on this scanline.
            // Only check if sprite 0 is in the secondary OAM for this scanline
            // (determined by evaluation on the previous scanline).
            // Sprite 0 hit requires BOTH BG and sprite rendering to be enabled.
            if (
              !this.hitSpr0 &&
              this.f_bgVisibility === 1 &&
              this.f_spVisibility === 1 &&
              this.scanlineSprite0[bufferScan]
            ) {
              if (this.checkSprite0(bufferScan)) {
                this.hitSpr0 = true;
              }
            }
          }

          // Evaluate sprites for the NEXT scanline. On real hardware this
          // happens during cycles 65-256 of each visible scanline. Evaluation
          // on scanline N determines sprites for scanline N+1.
          // The evaluation target is bufferScan+1 because sprites have a +1 Y
          // offset (sprite Y=0 renders on display row 1, not row 0).
          // See https://www.nesdev.org/wiki/PPU_sprite_evaluation
          if (bufferScan < 240) {
            this.evaluateSprites(bufferScan + 1);
          }

          // Pre-compute sprite 0 hit for the NEXT visible scanline. The BG
          // render above advanced the scroll counters to the next row, and
          // evaluateSprites just set up the secondary OAM for the next row.
          // By detecting the hit now, step()'s dot loop will see spr0HitX/Y
          // when processing the next scanline's dots, allowing the hit flag
          // to be set at the correct PPU cycle.
          if (
            !this.hitSpr0 &&
            this.f_bgVisibility === 1 &&
            this.f_spVisibility === 1
          ) {
            this._precomputeSprite0Hit(bufferScan + 1);
            if (this.spr0HitX !== -1) {
              this.hitSpr0 = true;
            }
          }

          if (this.f_bgVisibility === 1 || this.f_spVisibility === 1) {
            // Clock mapper IRQ Counter:
            this.nes.mmap.clockIrqCounter();
          }
        }
    }

    this.scanline++;
    this.regsToAddress();
    this.cntsToAddress();
  }

  startFrame() {
    // Clear per-scanline sprite evaluation data from the previous frame.
    // scanlineSpriteCount is set to 0 so no sprites render on un-evaluated
    // scanlines. scanlineSprite0 is cleared to prevent stale sprite 0 hits.
    // Note: the pre-render scanline handler (case 20 in endScanline) may
    // later set scanlineSpriteCount[1] with stale data from the hardware
    // secondary OAM, allowing sprites to appear on NES scanline 0.
    // We don't need to clear scanlineSecondaryOAM here because:
    // - Evaluated scanlines fill it in evaluateSprites() (phase 1 clear)
    // - The pre-render handler fills row 1 from stale secondaryOAM
    // - scanlineSecondaryOAM for other non-evaluated rows is never read
    //   because their scanlineSpriteCount is 0
    this.scanlineSpriteCount.fill(0);
    this.scanlineSprite0.fill(0);

    // Set background color:
    let bgColor;

    if (this.f_dispType === 0) {
      // Color display.
      // f_color determines color emphasis.
      // Use first entry of image palette as BG color.
      bgColor = this.imgPalette[0];
    } else {
      // Monochrome display.
      // f_color determines the bg color.
      switch (this.f_color) {
        case 0:
          // Black
          bgColor = 0x00000;
          break;
        case 1:
          // Green
          bgColor = 0x00ff00;
          break;
        case 2:
          // Blue
          bgColor = 0x0000ff;
          break;
        case 3:
          // Invalid. Use black.
          bgColor = 0x000000;
          break;
        case 4:
          // Red
          bgColor = 0xff0000;
          break;
        default:
          // Invalid. Use black.
          bgColor = 0x0;
      }
    }

    this.buffer.fill(bgColor);
    this.pixrendered.fill(65);
  }

  endFrame() {
    let i, y;
    let buffer = this.buffer;

    // Draw spr#0 hit coordinates:
    if (this.showSpr0Hit) {
      // Spr 0 position:
      if (
        this.sprX[0] >= 0 &&
        this.sprX[0] < 256 &&
        this.sprY[0] >= 0 &&
        this.sprY[0] < 240
      ) {
        for (i = 0; i < 256; i++) {
          buffer[(this.sprY[0] << 8) + i] = 0xff5555;
        }
        for (i = 0; i < 240; i++) {
          buffer[(i << 8) + this.sprX[0]] = 0xff5555;
        }
      }
      // Hit position:
      if (
        this.spr0HitX >= 0 &&
        this.spr0HitX < 256 &&
        this.spr0HitY >= 0 &&
        this.spr0HitY < 240
      ) {
        for (i = 0; i < 256; i++) {
          buffer[(this.spr0HitY << 8) + i] = 0x55ff55;
        }
        for (i = 0; i < 240; i++) {
          buffer[(i << 8) + this.spr0HitX] = 0x55ff55;
        }
      }
    }

    // This is a bit lazy..
    // if either the sprites or the background should be clipped,
    // both are clipped after rendering is finished.
    if (
      this.clipToTvSize ||
      this.f_bgClipping === 0 ||
      this.f_spClipping === 0
    ) {
      // Clip left 8-pixels column:
      for (y = 0; y < 240; y++) {
        buffer.fill(0, y << 8, (y << 8) + 8);
      }
    }

    if (this.clipToTvSize) {
      // Clip right 8-pixels column too:
      for (y = 0; y < 240; y++) {
        buffer.fill(0, (y << 8) + 248, (y << 8) + 256);
      }

      // Clip top and bottom 8 pixels:
      buffer.fill(0, 0, 8 << 8);
      buffer.fill(0, 232 << 8, 240 << 8);
    }

    this.nes.ui.writeFrame(buffer);
  }

  updateControlReg1(value) {
    this.triggerRendering();

    this.f_nmiOnVblank = (value >> 7) & 1;
    this.f_spriteSize = (value >> 5) & 1;
    this.f_bgPatternTable = (value >> 4) & 1;
    this.f_spPatternTable = (value >> 3) & 1;
    this.f_addrInc = (value >> 2) & 1;
    this.f_nTblAddress = value & 3;

    this.regV = (value >> 1) & 1;
    this.regH = value & 1;
    this.regS = (value >> 4) & 1;

    // Writing $2000 can toggle NMI enable while VBlank is active. If NMI is
    // enabled during VBlank, a rising edge fires NMI. If disabled, a pending
    // NMI is cancelled. See https://www.nesdev.org/wiki/NMI
    this._updateNmiOutput();
  }

  // Recomputes the NMI output level from (vblankFlag AND nmiEnabled).
  // On a false→true transition (rising edge), sets nmiRaised on the CPU.
  // On a true→false transition (falling edge), may cancel a not-yet-latched
  // NMI edge.
  //
  // On real 6502 hardware, the NMI edge detector samples the /NMI line at
  // φ2 of each CPU cycle. Once a falling edge is detected (line goes low),
  // the internal NMI signal is latched and held until the NMI handler
  // begins executing — even if /NMI goes back high on the very next cycle.
  //
  // The edge detector needs the NMI output to be stably asserted before φ2
  // to latch. Two cases where the edge is NOT latched:
  //
  // 1. Same bus cycle: NMI output went high→low within one bus cycle.
  //    The edge detector never saw a stable assertion at φ2.
  //
  // 2. Post-loop boundary: NMI output went high at the very end of a
  //    step() call (post-loop check, nmiDotsRemainingInStep=0), right at
  //    the φ2 boundary. If the NEXT bus cycle immediately causes a falling
  //    edge (e.g., $2002 read clearing VBL) BEFORE its step() runs, the
  //    edge detector at the next φ2 sees the line deasserted. This models
  //    the PPU→CPU propagation delay for NMI output changes right at φ2.
  //
  // nmiPending (promoted from a previous instruction) is never cleared.
  // See https://www.nesdev.org/wiki/NMI
  _updateNmiOutput() {
    let vblank = (this.nes.cpu.mem[0x2002] & 0x80) !== 0;
    let newOutput = this.f_nmiOnVblank !== 0 && vblank;
    if (newOutput && !this.nmiOutput) {
      // Rising edge: set nmiRaised. At the end of the current instruction,
      // the CPU checks how many bus cycles remained after this edge to
      // determine 0-delay (immediate) vs 1-delay NMI.
      this.nes.cpu.nmiRaised = true;
      this.nes.cpu.nmiRaisedAtCycle = this.nes.cpu.instrBusCycles;
    } else if (!newOutput && this.nmiOutput) {
      // Falling edge: cancel nmiRaised only if it hasn't been latched yet.
      if (this.nes.cpu.nmiRaised) {
        let busCycleDiff =
          this.nes.cpu.instrBusCycles - this.nes.cpu.nmiRaisedAtCycle;
        if (
          busCycleDiff === 0 ||
          (busCycleDiff === 1 && this.nes.cpu.nmiDotsRemainingInStep === 0)
        ) {
          // Case 1: same bus cycle, or Case 2: post-loop edge on the
          // immediately previous bus cycle. Edge not latched — cancel.
          this.nes.cpu.nmiRaised = false;
        }
        // else: edge was latched at a previous φ2, don't cancel.
      }
    }
    this.nmiOutput = newOutput;
  }

  updateControlReg2(value) {
    this.triggerRendering();

    this.f_color = (value >> 5) & 7;
    this.f_spVisibility = (value >> 4) & 1;
    this.f_bgVisibility = (value >> 3) & 1;
    this.f_spClipping = (value >> 2) & 1;
    this.f_bgClipping = (value >> 1) & 1;
    this.f_dispType = value & 1;

    // When both BG and sprite rendering become enabled mid-scanline,
    // re-check sprite 0 hit. The unified PPU pipeline populates BG shift
    // registers whenever either flag is set, so BG tile data exists in
    // pixrendered even if only sprites were previously enabled. Re-enabling
    // BG mid-scanline can trigger sprite 0 hit against this data.
    if (
      !this.hitSpr0 &&
      this.f_bgVisibility === 1 &&
      this.f_spVisibility === 1 &&
      this.scanline >= 21 &&
      this.scanline <= 260
    ) {
      let bufferScan = this.scanline + 1 - 21;
      if (this.scanlineSprite0[bufferScan]) {
        if (this.checkSprite0(bufferScan)) {
          this.hitSpr0 = true;
        }
      }
    }

    if (this.f_dispType === 0) {
      this.palTable.setEmphasis(this.f_color);
    }
    this.updatePalettes();
  }

  setStatusFlag(flag, value) {
    let n = 1 << flag;
    this.nes.cpu.mem[0x2002] =
      (this.nes.cpu.mem[0x2002] & (255 - n)) | (value ? n : 0);
  }

  // CPU Register $2002:
  // Read the Status Register.
  readStatusRegister() {
    let tmp = this.nes.cpu.mem[0x2002];

    // Reset scroll & VRAM Address toggle:
    this.firstWrite = true;

    // NMI suppression: reading $2002 one PPU dot BEFORE VBlank is set
    // (curX=0 of scanline 0 / NES scanline 241) causes the VBL flag to
    // never be set for this frame, suppressing both the flag and NMI.
    // The read itself correctly returns VBL=0 (it hasn't been set yet).
    //
    // At curX=1 (the exact VBL set dot), the post-loop check in
    // _ppuCatchUp() already fired VBlank, so VBL=1 here. The read sees
    // VBL=1, clears the flag, and _updateNmiOutput() below cancels NMI
    // (the flag was held for less than 1 CPU cycle). This matches Mesen's
    // behavior where VBL reads as SET at the simultaneous dot.
    //
    // See https://www.nesdev.org/wiki/PPU_frame_timing
    if (this.scanline === 0 && this.curX === 0) {
      this.nmiSuppressed = true;
    }

    // Clear VBlank flag:
    this.setStatusFlag(this.STATUS_VBLANK, false);

    // Clearing VBlank may cause a falling edge on NMI output, cancelling
    // any pending NMI.
    this._updateNmiOutput();

    // Only bits 7-5 come from the status register; bits 4-0 are open bus.
    tmp = (tmp & 0xe0) | (this.openBusLatch & 0x1f);
    this.openBusLatch = tmp;
    this.openBusDecayFrames = 36; // ~600ms at 60fps

    // Fetch status data:
    return tmp;
  }

  // CPU Register $2003:
  // Write the SPR-RAM address that is used for sramWrite (Register 0x2004 in CPU memory map)
  writeSRAMAddress(address) {
    this.sramAddress = address;
  }

  // CPU Register $2004 (R):
  // Read from SPR-RAM (Sprite RAM / OAM).
  // During rendering, returns phase-dependent values instead of normal OAM:
  //  - Cycles 1-64 (secondary OAM clear): returns $FF
  //  - Cycles 65-256 (sprite evaluation): returns the byte being read
  //  - Cycles 257-320 (sprite tile loading): returns secondary OAM data
  // During VBlank or when rendering is disabled, returns OAM[OAMADDR] normally.
  // Bits 2-4 of byte 2 (attributes) always read as 0 (unimplemented bits).
  // See https://www.nesdev.org/wiki/PPU_registers#OAMDATA
  sramLoad() {
    let renderingEnabled =
      this.f_spVisibility === 1 || this.f_bgVisibility === 1;

    // During visible or pre-render scanlines with rendering enabled,
    // $2004 reads return internal PPU sprite data, not OAM directly.
    // See https://www.nesdev.org/wiki/PPU_registers#OAMDATA
    if (renderingEnabled && this.scanline >= 20 && this.scanline <= 260) {
      let dot = this.curX;
      if (dot <= 64) {
        // Dots 0-64: secondary OAM clear phase (dots 1-64, plus idle dot 0).
        // $2004 reads always return $FF because the internal clear signal
        // forces the OAM read bus to $FF.
        return 0xff;
      } else if (dot <= 256) {
        // Dots 65-256: sprite evaluation phase. $2004 returns the OAM byte
        // currently being read by the evaluation logic. We approximate this
        // by returning OAM[OAMADDR] since OAMADDR tracks the evaluation
        // read pointer during this phase.
        // Bits 2-4 of attribute bytes (byte 2 of each entry) always read as 0.
        let val = this.spriteMem[this.sramAddress];
        if ((this.sramAddress & 3) === 2) {
          val &= 0xe3;
        }
        return val;
      } else {
        // Dots 257-340: sprite tile loading and background prefetch.
        // $2004 reads return $FF during this entire phase. The PPU's
        // internal OAM read bus is not driven by the evaluation logic.
        // See AccuracyCoin "$2004 behavior" test.
        return 0xff;
      }
    }

    // Normal read during VBlank or rendering disabled.
    // Bits 2-4 of attribute byte are unimplemented, always read as 0.
    let value = this.spriteMem[this.sramAddress];
    if ((this.sramAddress & 3) === 2) {
      value &= 0xe3;
    }
    return value;
  }

  // CPU Register $2004 (W):
  // Write to SPR-RAM (Sprite RAM).
  // The address should be set first.
  sramWrite(value) {
    let renderingEnabled =
      this.f_spVisibility === 1 || this.f_bgVisibility === 1;

    if (renderingEnabled && this.scanline >= 20 && this.scanline <= 260) {
      // During rendering on visible/pre-render scanlines, writes to $2004
      // are suppressed (value is NOT stored to OAM). Instead, OAMADDR is
      // incremented by 4 and ANDed with $FC, matching the hardware's
      // internal evaluation counter behavior.
      // See https://www.nesdev.org/wiki/PPU_registers#OAMDATA
      this.sramAddress = (this.sramAddress + 4) & 0xfc;
    } else {
      // Normal write during VBlank or rendering disabled
      this.spriteMem[this.sramAddress] = value;
      this.spriteRamWriteUpdate(this.sramAddress, value);
      this.sramAddress++;
      this.sramAddress %= 0x100;
    }
  }

  // CPU Register $2005:
  // Write to scroll registers.
  // The first write is the vertical offset, the second is the
  // horizontal offset:
  scrollWrite(value) {
    this.triggerRendering();

    if (this.firstWrite) {
      // First write, horizontal scroll:
      this.regHT = (value >> 3) & 31;
      this.regFH = value & 7;
    } else {
      // Second write, vertical scroll:
      this.regFV = value & 7;
      this.regVT = (value >> 3) & 31;
    }
    this.firstWrite = !this.firstWrite;
  }

  // CPU Register $2006:
  // Sets the adress used when reading/writing from/to VRAM.
  // The first write sets the high byte, the second the low byte.
  writeVRAMAddress(address) {
    if (this.firstWrite) {
      this.regFV = (address >> 4) & 3;
      this.regV = (address >> 3) & 1;
      this.regH = (address >> 2) & 1;
      this.regVT = (this.regVT & 7) | ((address & 3) << 3);
    } else {
      this.triggerRendering();

      this.regVT = (this.regVT & 24) | ((address >> 5) & 7);
      this.regHT = address & 31;

      this.cntFV = this.regFV;
      this.cntV = this.regV;
      this.cntH = this.regH;
      this.cntVT = this.regVT;
      this.cntHT = this.regHT;

      this.checkSprite0(this.scanline + 1 - 21);
    }

    this.firstWrite = !this.firstWrite;

    // Invoke mapper latch:
    this.cntsToAddress();
    if (this.vramAddress < 0x2000) {
      this.nes.mmap.latchAccess(this.vramAddress);
    }
  }

  // CPU Register $2007(R):
  // Read from PPU memory. The address should be set first.
  vramLoad() {
    let tmp;

    this.cntsToAddress();
    this.regsToAddress();

    // If address is in range 0x0000-0x3EFF, return buffered values:
    if (this.vramAddress <= 0x3eff) {
      tmp = this.vramBufferedReadValue;

      // Update buffered value:
      if (this.vramAddress < 0x2000) {
        this.vramBufferedReadValue = this.vramMem[this.vramAddress];
      } else {
        this.vramBufferedReadValue = this.mirroredLoad(this.vramAddress);
      }

      // Mapper latch access:
      if (this.vramAddress < 0x2000) {
        this.nes.mmap.latchAccess(this.vramAddress);
      }

      this._incrementVramAddress();

      this.cntsFromAddress();
      this.regsFromAddress();

      return tmp; // Return the previous buffered value.
    }

    // Palette RAM ($3F00-$3FFF): value is returned directly (no buffer
    // delay), but the read buffer is loaded with the nametable data
    // "behind" the palette at (address & $2FFF).
    // Palette RAM is only 32 bytes; addresses mirror every $20 bytes.
    // Backdrop mirrors: $3F10/$3F14/$3F18/$3F1C → $3F00/$3F04/$3F08/$3F0C.
    // Values are 6-bit; upper 2 bits come from the PPU open bus latch.
    // See https://www.nesdev.org/wiki/PPU_palettes
    let palIdx = this.vramAddress & 0x1f;
    if ((palIdx & 0x13) === 0x10) {
      palIdx &= 0x0f; // backdrop mirror
    }
    tmp = (this.vramMem[0x3f00 + palIdx] & 0x3f) | (this.openBusLatch & 0xc0);

    // Update buffer with nametable data behind the palette
    this.vramBufferedReadValue = this.mirroredLoad(this.vramAddress & 0x2fff);

    this._incrementVramAddress();

    this.cntsFromAddress();
    this.regsFromAddress();

    return tmp;
  }

  // CPU Register $2007(W):
  // Write to PPU memory. The address should be set first.
  vramWrite(value) {
    this.triggerRendering();
    this.cntsToAddress();
    this.regsToAddress();

    if (this.vramAddress >= 0x2000) {
      // Mirroring is used.
      this.mirroredWrite(this.vramAddress, value);
    } else {
      // Pattern table ($0000-$1FFF): writable if CHR RAM is mapped here.
      // The mapper decides — most mappers allow writes only when there's no
      // CHR ROM at all, but some (e.g. TQROM/mapper 119) have both CHR ROM
      // and CHR RAM and allow writes to CHR RAM-mapped regions.
      if (this.nes.mmap.canWriteChr(this.vramAddress)) {
        this.writeMem(this.vramAddress, value);
      }

      // Invoke mapper latch:
      this.nes.mmap.latchAccess(this.vramAddress);
    }

    this._incrementVramAddress();
    this.regsFromAddress();
    this.cntsFromAddress();
  }

  // CPU Register $4014:
  // Write 256 bytes of main memory into Sprite RAM (OAM).
  // DMA always copies exactly 256 bytes from CPU page $XX00-$XXFF.
  // The destination starts at the current OAMADDR and wraps within OAM.
  // See https://www.nesdev.org/wiki/PPU_registers#OAMDMA
  sramDMA(value) {
    let baseAddress = value * 0x100;
    let data;
    for (let i = 0; i < 256; i++) {
      data = this.nes.cpu.mem[baseAddress + i];
      let oamAddr = (this.sramAddress + i) & 0xff;
      this.spriteMem[oamAddr] = data;
      this.spriteRamWriteUpdate(oamAddr, data);
    }

    // OAM DMA takes 513 CPU cycles (1 wait + 256 read/write pairs), plus
    // an extra alignment cycle if the CPU is on an odd cycle (a "put" cycle).
    // This ensures the DMA always begins on an even cycle, synchronizing the
    // CPU to a known cycle parity. The AccuracyCoin controller strobe test
    // relies on this alignment to verify APU-clock-gated OUT0 behavior.
    // See https://www.nesdev.org/wiki/DMA#OAM_DMA
    let cpu = this.nes.cpu;
    let currentCycle = cpu._cpuCycleBase + cpu.instrBusCycles;
    let cycles = currentCycle % 2 === 0 ? 514 : 513;
    cpu.haltCycles(cycles);
  }

  // Updates the scroll registers from a new VRAM address.
  regsFromAddress() {
    let address = (this.vramTmpAddress >> 8) & 0xff;
    this.regFV = (address >> 4) & 7;
    this.regV = (address >> 3) & 1;
    this.regH = (address >> 2) & 1;
    this.regVT = (this.regVT & 7) | ((address & 3) << 3);

    address = this.vramTmpAddress & 0xff;
    this.regVT = (this.regVT & 24) | ((address >> 5) & 7);
    this.regHT = address & 31;
  }

  // Increments the VRAM address after a $2007 read or write. During active
  // rendering (either BG or sprites enabled on a visible/pre-render scanline),
  // the increment behaves differently: instead of the normal +1 or +32 linear
  // increment, the PPU performs simultaneous coarse X and Y increments with
  // proper wrapping. This is because the v register is being used as part of
  // the rendering address logic, not as a simple pointer.
  // See https://www.nesdev.org/wiki/PPU_scrolling#$2007_reads_and_writes
  // See https://www.nesdev.org/wiki/PPU_registers#PPUDATA
  _incrementVramAddress() {
    let renderingEnabled =
      this.f_spVisibility === 1 || this.f_bgVisibility === 1;
    // jsnes scanlines 20-260 = NES pre-render + visible scanlines
    let onRenderingScanline = this.scanline >= 20 && this.scanline <= 260;

    if (renderingEnabled && onRenderingScanline) {
      // Coarse X increment (with horizontal nametable toggle on overflow)
      if ((this.vramAddress & 0x001f) === 31) {
        this.vramAddress &= ~0x001f; // coarse X = 0
        this.vramAddress ^= 0x0400; // toggle horizontal nametable
      } else {
        this.vramAddress += 1;
      }

      // Y increment: fine Y first, then coarse Y on overflow
      if ((this.vramAddress & 0x7000) !== 0x7000) {
        this.vramAddress += 0x1000; // fine Y += 1
      } else {
        this.vramAddress &= ~0x7000; // fine Y = 0
        let coarseY = (this.vramAddress >> 5) & 0x1f;
        if (coarseY === 29) {
          coarseY = 0;
          this.vramAddress ^= 0x0800; // toggle vertical nametable
        } else if (coarseY === 31) {
          coarseY = 0; // wrap without nametable toggle
        } else {
          coarseY += 1;
        }
        this.vramAddress = (this.vramAddress & ~0x03e0) | (coarseY << 5);
      }
    } else {
      // Normal linear increment outside rendering
      this.vramAddress += this.f_addrInc === 1 ? 32 : 1;
    }
  }

  // Updates the scroll registers from a new VRAM address.
  cntsFromAddress() {
    let address = (this.vramAddress >> 8) & 0xff;
    this.cntFV = (address >> 4) & 3;
    this.cntV = (address >> 3) & 1;
    this.cntH = (address >> 2) & 1;
    this.cntVT = (this.cntVT & 7) | ((address & 3) << 3);

    address = this.vramAddress & 0xff;
    this.cntVT = (this.cntVT & 24) | ((address >> 5) & 7);
    this.cntHT = address & 31;
  }

  regsToAddress() {
    let b1 = (this.regFV & 7) << 4;
    b1 |= (this.regV & 1) << 3;
    b1 |= (this.regH & 1) << 2;
    b1 |= (this.regVT >> 3) & 3;

    let b2 = (this.regVT & 7) << 5;
    b2 |= this.regHT & 31;

    this.vramTmpAddress = ((b1 << 8) | b2) & 0x7fff;
  }

  cntsToAddress() {
    let b1 = (this.cntFV & 7) << 4;
    b1 |= (this.cntV & 1) << 3;
    b1 |= (this.cntH & 1) << 2;
    b1 |= (this.cntVT >> 3) & 3;

    let b2 = (this.cntVT & 7) << 5;
    b2 |= this.cntHT & 31;

    this.vramAddress = ((b1 << 8) | b2) & 0x7fff;
  }

  incTileCounter(count) {
    for (let i = count; i !== 0; i--) {
      this.cntHT++;
      if (this.cntHT === 32) {
        this.cntHT = 0;
        this.cntVT++;
        if (this.cntVT >= 30) {
          this.cntH++;
          if (this.cntH === 2) {
            this.cntH = 0;
            this.cntV++;
            if (this.cntV === 2) {
              this.cntV = 0;
              this.cntFV++;
              this.cntFV &= 0x7;
            }
          }
        }
      }
    }
  }

  // Reads from memory, taking into account
  // mirroring/mapping of address ranges.
  mirroredLoad(address) {
    return this.vramMem[this.vramMirrorTable[address]];
  }

  // Writes to memory, taking into account
  // mirroring/mapping of address ranges.
  mirroredWrite(address, value) {
    if (address >= 0x3f00 && address < 0x3f20) {
      // Palette write mirroring.
      if (address === 0x3f00 || address === 0x3f10) {
        this.writeMem(0x3f00, value);
        this.writeMem(0x3f10, value);
      } else if (address === 0x3f04 || address === 0x3f14) {
        this.writeMem(0x3f04, value);
        this.writeMem(0x3f14, value);
      } else if (address === 0x3f08 || address === 0x3f18) {
        this.writeMem(0x3f08, value);
        this.writeMem(0x3f18, value);
      } else if (address === 0x3f0c || address === 0x3f1c) {
        this.writeMem(0x3f0c, value);
        this.writeMem(0x3f1c, value);
      } else {
        this.writeMem(address, value);
      }
    } else {
      // Use lookup table for mirrored address:
      if (address < this.vramMirrorTable.length) {
        this.writeMem(this.vramMirrorTable[address], value);
      } else {
        throw new Error(`Invalid VRAM address: ${address.toString(16)}`);
      }
    }
  }

  triggerRendering() {
    // Guard against recursion from mapper latch bank switches during rendering.
    // When the PPU is already rendering and a latch-triggered loadVromBank calls
    // triggerRendering, we must not re-enter the rendering loop.
    if (this._inRendering) return;
    if (this.scanline >= 21 && this.scanline <= 260) {
      // Render sprites, and combine:
      this.renderFramePartially(
        this.lastRenderedScanline + 1,
        this.scanline - 21 - this.lastRenderedScanline,
      );

      // Set last rendered scanline:
      this.lastRenderedScanline = this.scanline - 21;
    }
  }

  renderFramePartially(startScan, scanCount) {
    this._inRendering = true;

    // Let the mapper swap CHR banks for sprite rendering.
    // MMC5 uses separate CHR bank sets for sprites vs backgrounds.
    this.nes.mmap.onSpriteRender();

    if (this.f_spVisibility === 1) {
      this.renderSpritesPartially(startScan, scanCount, 1);
    }

    if (this.f_bgVisibility === 1) {
      let si = startScan << 8;
      let ei = (startScan + scanCount) << 8;
      if (ei > 0xf000) {
        ei = 0xf000;
      }
      let buffer = this.buffer;
      let bgbuffer = this.bgbuffer;
      let pixrendered = this.pixrendered;
      for (let destIndex = si; destIndex < ei; destIndex++) {
        if (pixrendered[destIndex] > 0xff) {
          buffer[destIndex] = bgbuffer[destIndex];
        }
      }
    }

    if (this.f_spVisibility === 1) {
      this.renderSpritesPartially(startScan, scanCount, 0);
    }

    // Restore BG CHR banks for subsequent background scanline rendering.
    this.nes.mmap.onBgRender();

    this._inRendering = false;
    this.validTileData = false;
  }

  renderBgScanline(bgbuffer, scan) {
    let baseTile = this.regS === 0 ? 0 : 256;
    // Base address for pattern table fetches (used for mapper latch triggers).
    // On real hardware, the PPU puts this address on its bus when fetching tile
    // data, and mappers like MMC2 monitor these fetches.
    let baseAddr = this.regS === 0 ? 0x0000 : 0x1000;
    let destIndex = (scan << 8) - this.regFH;

    this.curNt = this.ntable1[this.cntV + this.cntV + this.cntH];

    this.cntHT = this.regHT;
    this.cntH = this.regH;
    this.curNt = this.ntable1[this.cntV + this.cntV + this.cntH];

    if (scan < 240 && scan - this.cntFV >= 0) {
      let tscanoffset = this.cntFV << 3;
      let scantile = this.scantile;
      let attrib = this.attrib;
      let ptTile = this.ptTile;
      let nameTable = this.nameTable;
      let imgPalette = this.imgPalette;
      let pixrendered = this.pixrendered;
      let targetBuffer = bgbuffer ? this.bgbuffer : this.buffer;
      let mmap = this.nes.mmap;

      let t, tpix, att, col;

      this._inRendering = true;

      // Let the mapper swap CHR banks for background rendering.
      // MMC5 uses separate CHR bank sets for sprites vs backgrounds.
      this.nes.mmap.onBgRender();

      // Simulate unused sprite slot dummy fetches from the previous scanline.
      // On real hardware, the PPU fetches patterns for 8 sprites per scanline
      // during cycles 257-320. Unused slots fetch tile $FF. In 8x16 sprite
      // mode, tile $FF selects pattern table $1000 (bit 0 = 1) with top-half
      // tile $FE. The high-plane byte fetch at $1FE8 triggers MMC2/MMC4
      // latch 1 → $FE, resetting it before the next scanline's BG fetches.
      // Without this, latch 1 can stay at $FD from a previous BG trigger tile,
      // causing sprite corruption (e.g. in Punch-Out!!'s crowd).
      // See https://www.nesdev.org/wiki/MMC2
      if (this.f_spriteSize === 1) {
        mmap.latchAccess(0x1fe8);
      }

      for (let tile = 0; tile < 32; tile++) {
        if (scan >= 0) {
          // Look up nametable tile index (needed for both rendering and mapper
          // latch access even when tile data is cached).
          let tileIndex = nameTable[this.curNt].getTileIndex(
            this.cntHT,
            this.cntVT,
          );

          // Fetch tile & attrib data:
          if (this.validTileData) {
            // Get data from array:
            t = scantile[tile];
            if (typeof t === "undefined") {
              continue;
            }
            tpix = t.pix;
            att = attrib[tile];
          } else {
            // Fetch data:
            t = ptTile[baseTile + tileIndex];
            if (typeof t === "undefined") {
              continue;
            }
            tpix = t.pix;
            att = nameTable[this.curNt].getAttrib(this.cntHT, this.cntVT);

            // MMC5 ExRAM mode 1: per-tile CHR bank and attribute override.
            // Each ExRAM byte provides a 4KB CHR bank (bits 5-0) and palette
            // (bits 7-6) for the corresponding background tile, allowing
            // each tile to use a different CHR bank independently.
            if (mmap.bgTileOverride) {
              let override = mmap.getBgTileData(
                baseTile,
                tileIndex,
                this.cntHT,
                this.cntVT,
              );
              if (override) {
                t = override.tile;
                tpix = t.pix;
                att = override.attrib;
              }
            }

            scantile[tile] = t;
            attrib[tile] = att;
          }

          // Render tile scanline:
          let sx = 0;
          let x = (tile << 3) - this.regFH;

          if (x > -8) {
            if (x < 0) {
              destIndex -= x;
              sx = -x;
            }
            if (t.opaque[this.cntFV]) {
              for (; sx < 8; sx++) {
                targetBuffer[destIndex] =
                  imgPalette[tpix[tscanoffset + sx] + att];
                pixrendered[destIndex] |= 256;
                destIndex++;
              }
            } else {
              for (; sx < 8; sx++) {
                col = tpix[tscanoffset + sx];
                if (col !== 0) {
                  targetBuffer[destIndex] = imgPalette[col + att];
                  pixrendered[destIndex] |= 256;
                }
                destIndex++;
              }
            }
          }

          // Mapper latch access: simulate the PPU's pattern table high byte
          // fetch. On real hardware, the PPU reads the high plane byte at
          // (baseAddr + tileIndex*16 + fineY + 8), and MMC2/MMC4 monitor
          // this address to trigger CHR bank switches. The latch updates
          // AFTER the fetch, so the current tile is rendered with the old
          // bank (correct, since we already read from ptTile above) and
          // subsequent tiles will use the new bank.
          // See https://www.nesdev.org/wiki/MMC2
          mmap.latchAccess(baseAddr + tileIndex * 16 + this.cntFV + 8);
        }

        // Increase Horizontal Tile Counter:
        if (++this.cntHT === 32) {
          this.cntHT = 0;
          this.cntH++;
          this.cntH %= 2;
          this.curNt = this.ntable1[(this.cntV << 1) + this.cntH];
        }
      }
      this._inRendering = false;

      // Tile data for one row should now have been fetched,
      // so the data in the array is valid.
      this.validTileData = true;
    }

    // update vertical scroll:
    this.cntFV++;
    if (this.cntFV === 8) {
      this.cntFV = 0;
      this.cntVT++;
      if (this.cntVT === 30) {
        this.cntVT = 0;
        this.cntV++;
        this.cntV %= 2;
        this.curNt = this.ntable1[(this.cntV << 1) + this.cntH];
      } else if (this.cntVT === 32) {
        this.cntVT = 0;
      }

      // Invalidate fetched data:
      this.validTileData = false;
    }
  }

  // OAM corruption (2C02G/H hardware bug): if OAMADDR is not zero at the
  // beginning of the pre-render or any visible scanline (when rendering is
  // enabled), the 8 bytes at (OAMADDR & $F8) are copied over the first 8
  // bytes of OAM. This is a DRAM refresh glitch, separate from evaluation.
  // See https://www.nesdev.org/wiki/PPU_OAM#Sprite_0_corruption
  performOAMCorruption() {
    let renderingEnabled =
      this.f_spVisibility === 1 || this.f_bgVisibility === 1;
    if (!renderingEnabled) return;
    if (this.sramAddress === 0) return;

    let srcBase = this.sramAddress & 0xf8;
    for (let i = 0; i < 8; i++) {
      this.spriteMem[i] = this.spriteMem[(srcBase + i) & 0xff];
    }
    // Update unpacked sprite data for the corrupted entries
    for (let i = 0; i < 8; i++) {
      this.spriteRamWriteUpdate(i, this.spriteMem[i]);
    }
  }

  // Evaluate sprites for the given scanline, populating secondary OAM and
  // storing results in per-scanline arrays for later batch rendering.
  //
  // On real hardware this runs during cycles 65-256 of each visible scanline,
  // finding up to 8 sprites that are in range for the NEXT scanline. The
  // algorithm is a state machine with counters n (sprite index, 0-63) and
  // m (byte within sprite, 0-3). It includes the hardware sprite overflow
  // bug where both n AND m are incremented when checking for a 9th sprite.
  //
  // targetScanline: the NES scanline (0-239) whose sprites we're evaluating.
  //   Evaluation on visible scanline N finds sprites for scanline N+1.
  //   Results are stored in scanlineSecondaryOAM[targetScanline].
  //
  // See https://www.nesdev.org/wiki/PPU_sprite_evaluation
  evaluateSprites(targetScanline) {
    let renderingEnabled =
      this.f_spVisibility === 1 || this.f_bgVisibility === 1;

    // On real hardware, secondary OAM clear and evaluation only happen when
    // rendering is enabled. When disabled, the secondary OAM retains stale
    // data from the last evaluation, and OAMADDR is not reset. We skip
    // clearing the per-scanline data too, so stale sprites persist.
    if (!renderingEnabled) return;

    // Phase 1: Clear secondary OAM to $FF (cycles 1-64)
    let oamBase = targetScanline * 32;
    for (let i = 0; i < 32; i++) {
      this.scanlineSecondaryOAM[oamBase + i] = 0xff;
    }
    this.scanlineSpriteCount[targetScanline] = 0;
    this.scanlineSprite0[targetScanline] = 0;

    let spriteHeight = this.f_spriteSize === 0 ? 8 : 16;
    let spritesFound = 0;
    let secondaryIndex = 0; // Write pointer into secondary OAM (0-31)

    // Phase 2: Sprite evaluation (cycles 65-256)
    // Start scanning from sprite n = OAMADDR / 4.
    // The starting OAMADDR determines which sprite is treated as "sprite 0"
    // for hit detection and priority. A misaligned OAMADDR (not divisible
    // by 4) causes m to start at a non-zero value, reading the wrong byte
    // types as Y coordinates.
    let startN = (this.sramAddress >> 2) & 0x3f;
    let startM = this.sramAddress & 0x03;
    let overflowM = 0; // m counter for overflow bug (separate from startM)

    let n = startN;
    let firstSprite = true; // First sprite may have misaligned m

    // Evaluation checks sprites from startN through 63, then stops when n
    // wraps back to 0. Sprites 0 through startN-1 are never checked, making
    // them invisible. This is documented behavior:
    // "No more sprites will be found once the end of OAM is reached,
    //  effectively hiding any sprites before the starting OAMADDR."
    // See https://www.nesdev.org/wiki/PPU_sprite_evaluation
    let evaluated = 0;
    do {
      let m;
      if (spritesFound >= 8) {
        // In overflow detection mode: use the buggy m counter
        m = overflowM;
      } else if (firstSprite) {
        // First sprite: m may be non-zero (misaligned OAMADDR)
        m = startM;
      } else {
        m = 0;
      }
      firstSprite = false;

      let yByte = this.spriteMem[(n * 4 + m) & 0xff];

      // Check if sprite is in range for the target buffer row.
      // On real hardware the comparison is NES_scanline >= Y && < Y + height.
      // Since targetScanline is in buffer coordinates (NES scanline + 1),
      // this becomes targetScanline > Y && targetScanline <= Y + height.
      // The comparison uses whatever byte we read (even if it's not Y).
      if (targetScanline > yByte && targetScanline <= yByte + spriteHeight) {
        if (spritesFound < 8) {
          // Copy 4 bytes to secondary OAM, starting from the actual read
          // address (n*4+m). When OAMADDR is misaligned (m != 0), this
          // copies garbled data: the bytes after m in this entry followed
          // by bytes from the next entry, matching hardware behavior.
          for (let b = 0; b < 4; b++) {
            this.scanlineSecondaryOAM[oamBase + secondaryIndex + b] =
              this.spriteMem[(n * 4 + m + b) & 0xff];
          }
          // The first sprite in evaluation order (at OAMADDR/4) is the one
          // that triggers sprite 0 hit, regardless of its OAM index.
          // On real hardware, setting OAMADDR to a non-zero value causes
          // the sprite at that address to act as "sprite 0" for hit detection.
          // See https://www.nesdev.org/wiki/PPU_OAM#Sprite_zero_hits
          if (evaluated === 0) {
            this.scanlineSprite0[targetScanline] = 1;
          }
          spritesFound++;
          secondaryIndex += 4;
        } else {
          // 9th in-range sprite found: set sprite overflow flag.
          // On real hardware this is STATUS_SLSPRITECOUNT (bit 5 of $2002).
          this.setStatusFlag(this.STATUS_SLSPRITECOUNT, true);
          break; // After overflow is found, evaluation enters idle
        }
      } else if (spritesFound >= 8) {
        // Sprite overflow bug: when 8 sprites have been found and we're
        // checking for a 9th, a hardware bug causes BOTH n and m to be
        // incremented when the sprite is not in range. This makes the
        // evaluation read diagonally through OAM — checking tile indices,
        // attributes, and X coordinates as if they were Y coordinates.
        // This produces both false positives and false negatives for overflow.
        // See https://www.nesdev.org/wiki/PPU_sprite_evaluation
        overflowM = (overflowM + 1) & 0x03;
      }

      n = (n + 1) & 0x3f;
      evaluated++;
    } while (n !== 0);

    this.scanlineSpriteCount[targetScanline] = spritesFound;

    // Also save to the hardware secondary OAM buffer. On real hardware,
    // secondary OAM is a physical 32-byte register that persists across
    // scanlines. It is NOT cleared on the pre-render scanline, so stale
    // data from the last visible scanline's evaluation can affect sprite
    // tile loading on the pre-render scanline, potentially causing sprites
    // to appear on NES scanline 0.
    // See https://www.nesdev.org/wiki/PPU_sprite_evaluation
    for (let i = 0; i < 32; i++) {
      this.secondaryOAM[i] = this.scanlineSecondaryOAM[oamBase + i];
    }
    this.spritesFound = spritesFound;
    this.sprite0InSecondary = this.scanlineSprite0[targetScanline] === 1;

    // OAMADDR is set to 0 during sprite tile loading (cycles 257-320).
    // On real hardware this happens at the start of HBlank.
    this.sramAddress = 0;
  }

  // Render sprites for a range of scanlines using per-scanline secondary OAM
  // data from sprite evaluation. Only the 8 (or fewer) sprites selected by
  // evaluation are rendered, enforcing the hardware's per-scanline sprite limit.
  //
  // bgPri: 0 = render sprites with bg priority 0 (in front of background),
  //         1 = render sprites with bg priority 1 (behind background).
  //
  // Each scanline's sprites come from scanlineSecondaryOAM[], populated by
  // evaluateSprites() during endScanline(). Sprite data is read from secondary
  // OAM format: [Y, tile, attributes, X] × 8 sprites.
  renderSpritesPartially(startscan, scancount, bgPri) {
    if (this.f_spVisibility !== 1) return;

    let mmap = this.nes.mmap;
    let ptTile = this.ptTile;
    let buffer = this.buffer;
    let sprPalette = this.sprPalette;
    let pixrendered = this.pixrendered;

    for (let scan = startscan; scan < startscan + scancount; scan++) {
      if (scan < 0 || scan >= 240) continue;

      let count = this.scanlineSpriteCount[scan];
      let oamBase = scan * 32;

      for (let i = 0; i < count; i++) {
        let sprY = this.scanlineSecondaryOAM[oamBase + i * 4 + 0];
        let sprTile = this.scanlineSecondaryOAM[oamBase + i * 4 + 1];
        let sprAttr = this.scanlineSecondaryOAM[oamBase + i * 4 + 2];
        let sprX = this.scanlineSecondaryOAM[oamBase + i * 4 + 3];

        let vertFlip = (sprAttr >> 7) & 1;
        let horiFlip = (sprAttr >> 6) & 1;
        let priority = (sprAttr >> 5) & 1;
        let palAdd = (sprAttr & 3) << 2;

        if (priority !== bgPri) continue;
        if (this.f_spriteSize === 0) {
          // 8x8 sprites
          let tileIndex = this.f_spPatternTable === 0 ? sprTile : sprTile + 256;
          let sprBaseAddr = this.f_spPatternTable === 0 ? 0x0000 : 0x1000;

          // Render only the one scanline row that falls on 'scan'
          let dy = sprY + 1; // +1 because sprite Y in OAM is display line - 1
          let fineY = scan - dy;
          if (fineY < 0 || fineY >= 8) continue;

          ptTile[tileIndex].render(
            buffer,
            0,
            fineY,
            8,
            fineY + 1,
            sprX,
            dy,
            palAdd,
            sprPalette,
            horiFlip,
            vertFlip,
            i, // priority: lower index in secondary OAM = higher priority
            pixrendered,
          );

          // Mapper latch: simulate PPU's sprite pattern table fetch.
          mmap.latchAccess(sprBaseAddr + sprTile * 16 + 8);
        } else {
          // 8x16 sprites: tile index bit 0 selects pattern table ($0000/$1000),
          // top tile is (index & $FE), bottom tile is (index & $FE) + 1.
          let sprBaseAddr = (sprTile & 1) !== 0 ? 0x1000 : 0x0000;
          let topTileNum = sprTile & 0xfe;
          let top = (sprTile & 1) !== 0 ? topTileNum + 256 : topTileNum;

          let dy = sprY + 1;
          let fineY = scan - dy;
          if (fineY < 0 || fineY >= 16) continue;

          // Determine which half (top/bottom) this scanline falls in
          let tileOffset, tileFineY;
          if (fineY < 8) {
            tileOffset = vertFlip ? 1 : 0;
            tileFineY = fineY;
          } else {
            tileOffset = vertFlip ? 0 : 1;
            tileFineY = fineY - 8;
          }

          ptTile[top + tileOffset].render(
            buffer,
            0,
            tileFineY,
            8,
            tileFineY + 1,
            sprX,
            dy + (fineY < 8 ? 0 : 8),
            palAdd,
            sprPalette,
            horiFlip,
            vertFlip,
            i,
            pixrendered,
          );

          // Mapper latch: simulate fetches for both halves of 8x16 sprite.
          mmap.latchAccess(sprBaseAddr + topTileNum * 16 + 8);
          mmap.latchAccess(sprBaseAddr + (topTileNum + 1) * 16 + 8);
        }
      }
    }
  }

  // Check if sprite 0 overlaps with a background tile pixel on this scanline.
  // "Sprite 0" is the first sprite in evaluation order — normally OAM entry 0,
  // but a non-zero OAMADDR can make a different entry act as sprite 0.
  //
  // On real hardware, sprite 0 hit only fires when a non-transparent sprite
  // pixel overlaps with a non-transparent background tile pixel. We check
  // pixrendered[bufferIndex] > 0xff because bit 8 (256) is set by
  // renderBgScanline when an actual background tile pixel is rendered.
  // See https://www.nesdev.org/wiki/PPU_OAM#Sprite_zero_hits
  checkSprite0(scan) {
    this.spr0HitX = -1;
    this.spr0HitY = -1;

    if (scan < 0 || scan >= 240) return false;
    if (!this.scanlineSprite0[scan]) return false;
    if (this.scanlineSpriteCount[scan] === 0) return false;

    // Read sprite 0's data from secondary OAM (first entry, slot 0).
    let oamBase = scan * 32;
    let sprY = this.scanlineSecondaryOAM[oamBase + 0];
    let sprTile = this.scanlineSecondaryOAM[oamBase + 1];
    let sprAttr = this.scanlineSecondaryOAM[oamBase + 2];
    let x = this.scanlineSecondaryOAM[oamBase + 3];
    let y = sprY + 1; // +1 because sprite Y in OAM is display line - 1

    let vertFlip = (sprAttr >> 7) & 1;
    let horiFlip = (sprAttr >> 6) & 1;

    // Sprite 0 hit has additional conditions beyond pixel overlap:
    // - No hit at x=255 (hardware doesn't check the last pixel)
    // - No hit at x=0..7 when left-side clipping is enabled for either
    //   sprites (f_spClipping===0) or background (f_bgClipping===0)
    // See https://www.nesdev.org/wiki/PPU_OAM#Sprite_zero_hits
    let leftClip = this.f_spClipping === 0 || this.f_bgClipping === 0;

    // Check each pixel of the sprite for overlap with background.
    // Returns the first x position where hit occurs, or -1 if no hit.
    let toffset;
    let t;

    // Use the mapper's getSpritePatternTile() instead of ptTile directly.
    // On MMC5 in 8x16 mode, ptTile may have BG data (Set B) after
    // renderBgScanline, but sprite 0 needs sprite data (Set A).
    let mmap = this.nes.mmap;

    if (this.f_spriteSize === 0) {
      // 8x8 sprites.
      let tIndexAdd = this.f_spPatternTable === 0 ? 0 : 256;
      if (y <= scan && y + 8 > scan && x < 256) {
        t = mmap.getSpritePatternTile(sprTile + tIndexAdd);
        toffset = vertFlip ? 7 - (scan - y) : scan - y;
        toffset *= 8;
        return this._checkSpr0Pixels(t, toffset, x, horiFlip, scan, leftClip);
      }
    } else {
      // 8x16 sprites: tile index bit 0 selects pattern table.
      if (y <= scan && y + 16 > scan && x < 256) {
        toffset = vertFlip ? 15 - (scan - y) : scan - y;

        if (toffset < 8) {
          t = mmap.getSpritePatternTile(
            sprTile + (vertFlip ? 1 : 0) + ((sprTile & 1) !== 0 ? 255 : 0),
          );
        } else {
          t = mmap.getSpritePatternTile(
            sprTile + (vertFlip ? 0 : 1) + ((sprTile & 1) !== 0 ? 255 : 0),
          );
          toffset = vertFlip ? 15 - toffset : toffset - 8;
        }
        toffset *= 8;
        return this._checkSpr0Pixels(t, toffset, x, horiFlip, scan, leftClip);
      }
    }

    return false;
  }

  // Helper: scan 8 pixels of sprite 0's tile row for overlap with background.
  // Checks for non-transparent sprite pixel overlapping non-transparent BG pixel,
  // excluding x=255 and left-clipped pixels (x=0..7 when leftClip is true).
  _checkSpr0Pixels(tile, toffset, startX, horiFlip, scan, leftClip) {
    let bufferIndex = scan * 256 + startX;

    for (let px = 0; px < 8; px++) {
      let tileIdx = horiFlip ? 7 - px : px;
      let pixelX = startX + px;

      if (pixelX >= 0 && pixelX < 255) {
        // Skip left 8 pixels when clipping is enabled
        if (leftClip && pixelX < 8) {
          bufferIndex++;
          continue;
        }

        if (
          bufferIndex >= 0 &&
          bufferIndex < 61440 &&
          this.pixrendered[bufferIndex] > 0xff &&
          tile.pix[toffset + tileIdx] !== 0
        ) {
          this.spr0HitX = pixelX;
          this.spr0HitY = scan;
          return true;
        }
      }
      bufferIndex++;
    }
    return false;
  }

  // Pre-computes sprite 0 hit for the NEXT scanline by checking BG tile data
  // directly, without requiring a full BG render. This is called after
  // renderBgScanline advances the scroll counters (cntFV/cntVT/cntV) to the
  // next row's position. By detecting the hit one scanline early, the dot-by-
  // dot loop in step() can set STATUS_SPRITE0HIT at the correct PPU cycle
  // instead of one full scanline late.
  //
  // The approach: for each of sprite 0's 8 pixels, compute which BG tile
  // occupies that screen position using the scroll registers, then check if
  // both the sprite pixel and BG pixel are non-transparent.
  //
  // See https://www.nesdev.org/wiki/PPU_OAM#Sprite_zero_hits
  _precomputeSprite0Hit(nextBufferScan) {
    if (nextBufferScan < 1 || nextBufferScan > 239) return false;
    if (!this.scanlineSprite0[nextBufferScan]) return false;
    if (this.scanlineSpriteCount[nextBufferScan] === 0) return false;

    // Read sprite 0 from secondary OAM for the next scanline.
    let oamBase = nextBufferScan * 32;
    let sprY = this.scanlineSecondaryOAM[oamBase + 0];
    let sprTile = this.scanlineSecondaryOAM[oamBase + 1];
    let sprAttr = this.scanlineSecondaryOAM[oamBase + 2];
    let sprX = this.scanlineSecondaryOAM[oamBase + 3];
    let y = sprY + 1; // +1 because sprite Y in OAM is display line - 1

    let vertFlip = (sprAttr >> 7) & 1;
    let horiFlip = (sprAttr >> 6) & 1;
    let leftClip = this.f_spClipping === 0 || this.f_bgClipping === 0;

    // Check if sprite 0 overlaps the next scanline.
    let spriteHeight = this.f_spriteSize === 0 ? 8 : 16;
    if (!(y <= nextBufferScan && y + spriteHeight > nextBufferScan))
      return false;
    if (sprX >= 256) return false;

    // Compute sprite tile row for this scanline.
    let sprRow = vertFlip
      ? spriteHeight - 1 - (nextBufferScan - y)
      : nextBufferScan - y;
    let sprTileObj, toffset;

    if (this.f_spriteSize === 0) {
      // 8x8 sprites.
      let tIndexAdd = this.f_spPatternTable === 0 ? 0 : 256;
      sprTileObj = this.ptTile[sprTile + tIndexAdd];
      toffset = sprRow * 8;
    } else {
      // 8x16 sprites: tile index bit 0 selects pattern table.
      let patternBase = (sprTile & 1) !== 0 ? 256 : 0;
      let baseTileIdx = sprTile & ~1;
      if (sprRow < 8) {
        sprTileObj =
          this.ptTile[baseTileIdx + patternBase + (vertFlip ? 1 : 0)];
        toffset = sprRow * 8;
      } else {
        sprTileObj =
          this.ptTile[baseTileIdx + patternBase + (vertFlip ? 0 : 1)];
        toffset = (sprRow - 8) * 8;
      }
    }
    if (!sprTileObj) return false;

    // BG vertical position: cntFV/cntVT/cntV have already been advanced to
    // the next row by renderBgScanline's scroll update.
    let bgFineY = this.cntFV;
    let bgCoarseY = this.cntVT;
    let bgNtV = this.cntV;
    let baseBgTile = this.regS === 0 ? 0 : 256;

    // Check each sprite pixel against the BG tile at that position.
    for (let px = 0; px < 8; px++) {
      let screenX = sprX + px;
      if (screenX >= 255) continue; // no hit at x=255
      if (leftClip && screenX < 8) continue;

      // Check sprite pixel non-transparent.
      let tileIdx = horiFlip ? 7 - px : px;
      if (sprTileObj.pix[toffset + tileIdx] === 0) continue;

      // Compute which BG tile covers this screen X using the horizontal
      // scroll registers (regHT/regH are reloaded at the start of each
      // visible scanline on real hardware).
      let tileOffset = (screenX + this.regFH) >> 3;
      let absCol = this.regHT + tileOffset;
      let bgNtH = this.regH;
      if (absCol >= 32) {
        absCol -= 32;
        bgNtH ^= 1; // toggle horizontal nametable
      }

      // Look up the BG tile from the nametable.
      let ntIdx = this.ntable1[(bgNtV << 1) + bgNtH];
      let bgTileIndex = this.nameTable[ntIdx].getTileIndex(absCol, bgCoarseY);
      let bgTile = this.ptTile[baseBgTile + bgTileIndex];
      if (!bgTile) continue;

      // Check BG pixel non-transparent at (fineX, fineY).
      let bgPixelX = (screenX + this.regFH) & 7;
      if (bgTile.pix[bgFineY * 8 + bgPixelX] !== 0) {
        // Hit found! Store in NES scanline coordinates for step() matching.
        // step() compares scanline - 21 against spr0HitY, where
        // scanline - 21 = bufferScan - 1, so we store nextBufferScan - 1.
        this.spr0HitX = screenX;
        this.spr0HitY = nextBufferScan - 1;
        return true;
      }
    }
    return false;
  }

  // This will write to PPU memory, and
  // update internally buffered data
  // appropriately.
  writeMem(address, value) {
    this.vramMem[address] = value;

    // Update internally buffered data:
    if (address < 0x2000) {
      this.vramMem[address] = value;
      this.patternWrite(address, value);
    } else if (address >= 0x2000 && address < 0x23c0) {
      this.nameTableWrite(this.ntable1[0], address - 0x2000, value);
    } else if (address >= 0x23c0 && address < 0x2400) {
      this.attribTableWrite(this.ntable1[0], address - 0x23c0, value);
    } else if (address >= 0x2400 && address < 0x27c0) {
      this.nameTableWrite(this.ntable1[1], address - 0x2400, value);
    } else if (address >= 0x27c0 && address < 0x2800) {
      this.attribTableWrite(this.ntable1[1], address - 0x27c0, value);
    } else if (address >= 0x2800 && address < 0x2bc0) {
      this.nameTableWrite(this.ntable1[2], address - 0x2800, value);
    } else if (address >= 0x2bc0 && address < 0x2c00) {
      this.attribTableWrite(this.ntable1[2], address - 0x2bc0, value);
    } else if (address >= 0x2c00 && address < 0x2fc0) {
      this.nameTableWrite(this.ntable1[3], address - 0x2c00, value);
    } else if (address >= 0x2fc0 && address < 0x3000) {
      this.attribTableWrite(this.ntable1[3], address - 0x2fc0, value);
    } else if (address >= 0x3f00 && address < 0x3f20) {
      this.updatePalettes();
    }
  }

  // Reads data from $3f00 to $f20
  // into the two buffered palettes.
  updatePalettes() {
    let i;

    for (i = 0; i < 16; i++) {
      if (this.f_dispType === 0) {
        this.imgPalette[i] = this.palTable.getEntry(
          this.vramMem[0x3f00 + i] & 63,
        );
      } else {
        this.imgPalette[i] = this.palTable.getEntry(
          this.vramMem[0x3f00 + i] & 0x30,
        );
      }
    }
    for (i = 0; i < 16; i++) {
      if (this.f_dispType === 0) {
        this.sprPalette[i] = this.palTable.getEntry(
          this.vramMem[0x3f10 + i] & 63,
        );
      } else {
        this.sprPalette[i] = this.palTable.getEntry(
          this.vramMem[0x3f10 + i] & 0x30,
        );
      }
    }
  }

  // Updates the internal pattern
  // table buffers with this new byte.
  // In vNES, there is a version of this with 4 arguments which isn't used.
  patternWrite(address, value) {
    let tileIndex = address >> 4;
    let leftOver = address & 15;
    if (leftOver < 8) {
      this.ptTile[tileIndex].setScanline(
        leftOver,
        value,
        this.vramMem[address + 8],
      );
    } else {
      this.ptTile[tileIndex].setScanline(
        leftOver - 8,
        this.vramMem[address - 8],
        value,
      );
    }
  }

  // Updates the internal name table buffers
  // with this new byte.
  nameTableWrite(index, address, value) {
    this.nameTable[index].tile[address] = value;

    // Update Sprite #0 hit:
    let bufferScan = this.scanline + 1 - 21;
    this.checkSprite0(bufferScan);
  }

  // Updates the internal pattern
  // table buffers with this new attribute
  // table byte.
  attribTableWrite(index, address, value) {
    this.nameTable[index].writeAttrib(address, value);
    // Also store the raw attribute byte in the tile array at offset 0x3C0
    // (= 960 = 30*32). On real hardware, when coarse Y is 30 or 31, the PPU's
    // nametable fetch address lands in the attribute table region and the raw
    // byte is used as a tile index. This is the "attributes as tiles" quirk.
    // See https://www.nesdev.org/wiki/PPU_scrolling
    this.nameTable[index].tile[0x3c0 + address] = value;
  }

  // Updates the internally buffered sprite
  // data with this new byte of info.
  spriteRamWriteUpdate(address, value) {
    let tIndex = address >> 2;

    if (tIndex === 0) {
      let bufferScan = this.scanline + 1 - 21;
      this.checkSprite0(bufferScan);
    }

    switch (address & 3) {
      case 0:
        // Y coordinate
        this.sprY[tIndex] = value;
        break;
      case 1:
        // Tile index
        this.sprTile[tIndex] = value;
        break;
      case 2:
        // Attributes
        this.vertFlip[tIndex] = (value >> 7) & 1;
        this.horiFlip[tIndex] = (value >> 6) & 1;
        this.bgPriority[tIndex] = (value >> 5) & 1;
        this.sprCol[tIndex] = (value & 3) << 2;
        break;
      case 3:
        // X coordinate
        this.sprX[tIndex] = value;
        break;
    }
  }

  isPixelWhite(x, y) {
    this.triggerRendering();
    return this.nes.ppu.buffer[(y << 8) + x] === 0xffffff;
  }

  toJSON() {
    let i;
    let state = toJSON(this);

    state.nameTable = [];
    for (i = 0; i < this.nameTable.length; i++) {
      state.nameTable[i] = this.nameTable[i].toJSON();
    }

    state.ptTile = [];
    for (i = 0; i < this.ptTile.length; i++) {
      state.ptTile[i] = this.ptTile[i].toJSON();
    }

    return state;
  }

  fromJSON(state) {
    let i;

    fromJSON(this, state);

    for (i = 0; i < this.nameTable.length; i++) {
      this.nameTable[i].fromJSON(state.nameTable[i]);
    }

    for (i = 0; i < this.ptTile.length; i++) {
      this.ptTile[i].fromJSON(state.ptTile[i]);
    }

    // Sprite data:
    for (i = 0; i < this.spriteMem.length; i++) {
      this.spriteRamWriteUpdate(i, this.spriteMem[i]);
    }
  }

  static JSON_PROPERTIES = [
    // Memory
    "vramMem",
    "spriteMem",
    // Counters
    "cntFV",
    "cntV",
    "cntH",
    "cntVT",
    "cntHT",
    // Registers
    "regFV",
    "regV",
    "regH",
    "regVT",
    "regHT",
    "regFH",
    "regS",
    // VRAM addr
    "vramAddress",
    "vramTmpAddress",
    // Control/Status registers
    "f_nmiOnVblank",
    "f_spriteSize",
    "f_bgPatternTable",
    "f_spPatternTable",
    "f_addrInc",
    "f_nTblAddress",
    "f_color",
    "f_spVisibility",
    "f_bgVisibility",
    "f_spClipping",
    "f_bgClipping",
    "f_dispType",
    // VRAM I/O
    "vramBufferedReadValue",
    "firstWrite",
    "openBusLatch",
    "openBusDecayFrames",
    // Mirroring
    "currentMirroring",
    "vramMirrorTable",
    "ntable1",
    // SPR-RAM I/O
    "sramAddress",
    // Sprites. Most sprite data is rebuilt from spriteMem
    "hitSpr0",
    // Secondary OAM: persistent hardware state (not cleared on pre-render)
    "secondaryOAM",
    "spritesFound",
    "sprite0InSecondary",
    // Palettes
    "sprPalette",
    "imgPalette",
    // Rendering progression
    "curX",
    "scanline",
    "lastRenderedScanline",
    "curNt",
    "scantile",
    // Used during rendering
    "attrib",
    "buffer",
    "bgbuffer",
    "pixrendered",
    // Misc
    "nmiOutput",
    "nmiSuppressed",
    "vblankPending",
    "dummyCycleToggle",
    "validTileData",
    "scanlineAlreadyRendered",
  ];
}

/* harmony default export */ const ppu = (PPU);

;// ./src/papu/channel-dm.js


class ChannelDM {
  static MODE_NORMAL = 0;
  static MODE_LOOP = 1;
  static MODE_IRQ = 2;

  static JSON_PROPERTIES = [
    "isEnabled",
    "hasSample",
    "irqGenerated",
    "playMode",
    "dmaFrequency",
    "dmaCounter",
    "deltaCounter",
    "playStartAddress",
    "playAddress",
    "playLength",
    "playLengthCounter",
    "shiftCounter",
    "reg4012",
    "reg4013",
    "sample",
    "dacLsb",
    "data",
    "lastFetchedByte",
  ];

  constructor(papu) {
    this.papu = papu;

    this.isEnabled = false;
    this.hasSample = false;
    this.irqGenerated = false;
    this.playMode = ChannelDM.MODE_NORMAL;
    this.dmaFrequency = 0;
    this.dmaCounter = 0;
    this.deltaCounter = 0;
    this.playStartAddress = 0;
    this.playAddress = 0;
    this.playLength = 0;
    this.playLengthCounter = 0;
    this.sample = 0;
    this.dacLsb = 0;
    this.shiftCounter = 0;
    this.reg4012 = 0;
    this.reg4013 = 0;
    this.data = 0;
    this.lastFetchedByte = 0;
  }

  clockDmc() {
    // Only alter DAC value if the sample buffer has data:
    if (this.hasSample) {
      if ((this.data & 1) === 0) {
        // Decrement delta:
        if (this.deltaCounter > 0) {
          this.deltaCounter--;
        }
      } else {
        // Increment delta:
        if (this.deltaCounter < 63) {
          this.deltaCounter++;
        }
      }

      // Update sample value:
      this.sample = this.isEnabled ? (this.deltaCounter << 1) + this.dacLsb : 0;

      // Update shift register:
      this.data >>= 1;
    }

    this.dmaCounter--;
    if (this.dmaCounter <= 0) {
      // No more sample bits.
      this.hasSample = false;
      this.endOfSample();
      this.dmaCounter = 8;
    }

    if (this.irqGenerated) {
      this.papu.nes.cpu.requestIrq(this.papu.nes.cpu.IRQ_NORMAL);
    }
  }

  endOfSample() {
    if (this.playLengthCounter === 0 && this.playMode === ChannelDM.MODE_LOOP) {
      // Start from beginning of sample:
      this.playAddress = this.playStartAddress;
      this.playLengthCounter = this.playLength;
    }

    if (this.playLengthCounter > 0) {
      // Fetch next sample:
      this.nextSample();

      if (this.playLengthCounter === 0) {
        // Last byte of sample fetched, generate IRQ:
        if (this.playMode === ChannelDM.MODE_IRQ) {
          // Generate IRQ:
          this.irqGenerated = true;
        }
      }
    }
  }

  nextSample() {
    // Fetch byte:
    this.data = this.papu.nes.mmap.load(this.playAddress);
    // On real hardware, the DMA fetch puts this byte on the CPU data bus.
    // Store it so cpu.load() can detect DMA bus hijacking mid-instruction.
    // See https://www.nesdev.org/wiki/APU_DMC#Memory_reader
    this.lastFetchedByte = this.data;
    this.papu.nes.cpu.haltCycles(4);

    this.playLengthCounter--;
    this.playAddress++;
    if (this.playAddress > 0xffff) {
      this.playAddress = 0x8000;
    }

    this.hasSample = true;
  }

  writeReg(address, value) {
    if (address === 0x4010) {
      // Play mode, DMA Frequency
      if (value >> 6 === 0) {
        this.playMode = ChannelDM.MODE_NORMAL;
      } else if (((value >> 6) & 1) === 1) {
        this.playMode = ChannelDM.MODE_LOOP;
      } else if (value >> 6 === 2) {
        this.playMode = ChannelDM.MODE_IRQ;
      }

      if ((value & 0x80) === 0) {
        this.irqGenerated = false;
      }

      this.dmaFrequency = this.papu.getDmcFrequency(value & 0xf);
    } else if (address === 0x4011) {
      // Delta counter load register:
      this.deltaCounter = (value >> 1) & 63;
      this.dacLsb = value & 1;
      this.sample = (this.deltaCounter << 1) + this.dacLsb; // update sample value
    } else if (address === 0x4012) {
      // DMA address load register.
      // Only updates the start address register — the active playAddress is
      // loaded from playStartAddress when a sample restart occurs (via $4015).
      // See https://www.nesdev.org/wiki/APU_DMC
      this.playStartAddress = (value << 6) | 0x0c000;
      this.reg4012 = value;
    } else if (address === 0x4013) {
      // Length of play code.
      // Only updates the length register — the active playLengthCounter is
      // loaded from playLength when a sample restart occurs (via $4015 or
      // loop). Writing $4013 does not affect a currently playing sample.
      // See https://www.nesdev.org/wiki/APU_DMC
      this.playLength = (value << 4) + 1;
      this.reg4013 = value;
    } else if (address === 0x4015) {
      // DMC/IRQ Status
      // Writing $4015 always clears the DMC IRQ flag first, before any
      // other effects. On real hardware, the flag clear occurs on the
      // write cycle, while DMA fetches happen 3-4 cycles later — so a
      // DMA fetch triggered by this write CAN set a new IRQ flag.
      // See https://www.nesdev.org/wiki/APU_DMC
      this.irqGenerated = false;

      if (((value >> 4) & 1) === 0) {
        // Disable: set bytes remaining to 0.
        this.playLengthCounter = 0;
      } else {
        // Enable: only restart the sample if bytes remaining is 0.
        // If the sample is still playing (bytes remaining > 0), this
        // write has no effect on playback.
        if (this.playLengthCounter === 0) {
          this.playAddress = this.playStartAddress;
          this.playLengthCounter = this.playLength;
          // On real hardware, when DMC is enabled and the sample buffer is
          // empty, a DMA fetch fires within a few CPU cycles. Trigger it
          // immediately so the DMASync loop in test ROMs can detect the
          // first fetch. See https://www.nesdev.org/wiki/APU_DMC
          if (!this.hasSample && this.playLengthCounter > 0) {
            this.nextSample();
            this.dmaCounter = 8;
            this.shiftCounter = this.dmaFrequency;
            // If the immediate DMA fetch consumed the last byte (e.g. a
            // 1-byte sample), set the IRQ flag just like endOfSample does.
            if (
              this.playLengthCounter === 0 &&
              this.playMode === ChannelDM.MODE_IRQ
            ) {
              this.irqGenerated = true;
            }
          }
        }
      }
    }
  }

  setEnabled(value) {
    // Just track the enable flag. The restart logic (reloading address and
    // length counter) is handled in writeReg for $4015, which is always
    // called after setEnabled in the $4015 write path.
    this.isEnabled = value;
  }

  getLengthStatus() {
    return this.playLengthCounter === 0 || !this.isEnabled ? 0 : 1;
  }

  getIrqStatus() {
    return this.irqGenerated ? 1 : 0;
  }

  toJSON() {
    return toJSON(this);
  }

  fromJSON(s) {
    fromJSON(this, s);
  }
}

/* harmony default export */ const channel_dm = (ChannelDM);

;// ./src/papu/channel-noise.js


class ChannelNoise {
  constructor(papu) {
    this.papu = papu;

    this.progTimerCount = 0;
    this.progTimerMax = 0;
    this.isEnabled = false;
    this.lengthCounter = 0;
    this.lengthCounterEnable = false;
    this.envDecayDisable = false;
    this.envDecayLoopEnable = false;
    this.envReset = false;
    this.shiftNow = false;
    this.envDecayRate = 0;
    this.envDecayCounter = 0;
    this.envVolume = 0;
    this.masterVolume = 0;
    this.shiftReg = 1;
    this.randomBit = 0;
    this.randomMode = 0;
    this.sampleValue = 0;
    this.tmp = 0;
    this.accValue = 0;
    this.accCount = 1;
  }

  clockLengthCounter() {
    if (this.lengthCounterEnable && this.lengthCounter > 0) {
      this.lengthCounter--;
      if (this.lengthCounter === 0) {
        this.updateSampleValue();
      }
    }
  }

  clockEnvDecay() {
    if (this.envReset) {
      // Reset envelope:
      this.envReset = false;
      this.envDecayCounter = this.envDecayRate + 1;
      this.envVolume = 0xf;
    } else if (--this.envDecayCounter <= 0) {
      // Normal handling:
      this.envDecayCounter = this.envDecayRate + 1;
      if (this.envVolume > 0) {
        this.envVolume--;
      } else {
        this.envVolume = this.envDecayLoopEnable ? 0xf : 0;
      }
    }
    if (this.envDecayDisable) {
      this.masterVolume = this.envDecayRate;
    } else {
      this.masterVolume = this.envVolume;
    }
    this.updateSampleValue();
  }

  updateSampleValue() {
    if (this.isEnabled && this.lengthCounter > 0) {
      this.sampleValue = this.randomBit * this.masterVolume;
    }
  }

  writeReg(address, value) {
    if (address === 0x400c) {
      // Volume/Envelope decay:
      this.envDecayDisable = (value & 0x10) !== 0;
      this.envDecayRate = value & 0xf;
      this.envDecayLoopEnable = (value & 0x20) !== 0;
      this.lengthCounterEnable = (value & 0x20) === 0;
      if (this.envDecayDisable) {
        this.masterVolume = this.envDecayRate;
      } else {
        this.masterVolume = this.envVolume;
      }
    } else if (address === 0x400e) {
      // Programmable timer:
      this.progTimerMax = this.papu.getNoiseWaveLength(value & 0xf);
      this.randomMode = value >> 7;
    } else if (address === 0x400f) {
      // Length counter — only loaded when the channel is enabled via $4015.
      // Writing this register while disabled has no effect on the length counter.
      // See https://www.nesdev.org/wiki/APU#Status_($4015)
      if (this.isEnabled) {
        this.lengthCounter = this.papu.getLengthMax(value & 248);
      }
      this.envReset = true;
    }
    // Update:
    //updateSampleValue();
  }

  setEnabled(value) {
    this.isEnabled = value;
    if (!value) {
      this.lengthCounter = 0;
    }
    this.updateSampleValue();
  }

  getLengthStatus() {
    return this.lengthCounter === 0 || !this.isEnabled ? 0 : 1;
  }

  toJSON() {
    return toJSON(this);
  }

  fromJSON(s) {
    fromJSON(this, s);
  }

  static JSON_PROPERTIES = [
    "isEnabled",
    "envDecayDisable",
    "envDecayLoopEnable",
    "lengthCounterEnable",
    "envReset",
    "shiftNow",
    "lengthCounter",
    "progTimerCount",
    "progTimerMax",
    "envDecayRate",
    "envDecayCounter",
    "envVolume",
    "masterVolume",
    "shiftReg",
    "randomBit",
    "randomMode",
    "sampleValue",
    "accValue",
    "accCount",
    "tmp",
  ];
}

/* harmony default export */ const channel_noise = (ChannelNoise);

;// ./src/papu/channel-square.js


class ChannelSquare {
  constructor(papu, square1) {
    this.papu = papu;

    // prettier-ignore
    this.dutyLookup = [
           0, 1, 0, 0, 0, 0, 0, 0,
           0, 1, 1, 0, 0, 0, 0, 0,
           0, 1, 1, 1, 1, 0, 0, 0,
           1, 0, 0, 1, 1, 1, 1, 1
      ];
    // prettier-ignore
    this.impLookup = [
           1,-1, 0, 0, 0, 0, 0, 0,
           1, 0,-1, 0, 0, 0, 0, 0,
           1, 0, 0, 0,-1, 0, 0, 0,
          -1, 0, 1, 0, 0, 0, 0, 0
      ];

    this.sqr1 = square1;

    this.progTimerCount = 0;
    this.progTimerMax = 0;
    this.lengthCounter = 0;
    this.squareCounter = 0;
    this.sweepCounter = 0;
    this.sweepCounterMax = 0;
    this.sweepMode = 0;
    this.sweepShiftAmount = 0;
    this.envDecayRate = 0;
    this.envDecayCounter = 0;
    this.envVolume = 0;
    this.masterVolume = 0;
    this.dutyMode = 0;
    this.vol = 0;
    this.isEnabled = false;
    this.lengthCounterEnable = false;
    this.sweepActive = false;
    this.sweepCarry = false;
    this.envDecayDisable = false;
    this.envDecayLoopEnable = false;
    this.envReset = false;
    this.updateSweepPeriod = false;
    this.sweepResult = 0;
    this.sampleValue = 0;
  }

  clockLengthCounter() {
    if (this.lengthCounterEnable && this.lengthCounter > 0) {
      this.lengthCounter--;
      if (this.lengthCounter === 0) {
        this.updateSampleValue();
      }
    }
  }

  clockEnvDecay() {
    if (this.envReset) {
      // Reset envelope:
      this.envReset = false;
      this.envDecayCounter = this.envDecayRate + 1;
      this.envVolume = 0xf;
    } else if (--this.envDecayCounter <= 0) {
      // Normal handling:
      this.envDecayCounter = this.envDecayRate + 1;
      if (this.envVolume > 0) {
        this.envVolume--;
      } else {
        this.envVolume = this.envDecayLoopEnable ? 0xf : 0;
      }
    }

    if (this.envDecayDisable) {
      this.masterVolume = this.envDecayRate;
    } else {
      this.masterVolume = this.envVolume;
    }
    this.updateSampleValue();
  }

  clockSweep() {
    if (--this.sweepCounter <= 0) {
      this.sweepCounter = this.sweepCounterMax + 1;
      if (
        this.sweepActive &&
        this.sweepShiftAmount > 0 &&
        this.progTimerMax > 7
      ) {
        // Calculate result from shifter:
        this.sweepCarry = false;
        if (this.sweepMode === 0) {
          this.progTimerMax += this.progTimerMax >> this.sweepShiftAmount;
          if (this.progTimerMax > 0x7ff) {
            this.progTimerMax = 4095;
            this.sweepCarry = true;
          }
        } else {
          this.progTimerMax =
            this.progTimerMax -
            ((this.progTimerMax >> this.sweepShiftAmount) +
              (this.sqr1 ? 1 : 0));
        }
      }
    }

    if (this.updateSweepPeriod) {
      this.updateSweepPeriod = false;
      this.sweepCounter = this.sweepCounterMax + 1;
    }
  }

  updateSampleValue() {
    if (this.isEnabled && this.lengthCounter > 0 && this.progTimerMax > 7) {
      if (
        this.sweepMode === 0 &&
        this.progTimerMax + (this.progTimerMax >> this.sweepShiftAmount) > 0x7ff
      ) {
        //if (this.sweepCarry) {
        this.sampleValue = 0;
      } else {
        this.sampleValue =
          this.masterVolume *
          this.dutyLookup[(this.dutyMode << 3) + this.squareCounter];
      }
    } else {
      this.sampleValue = 0;
    }
  }

  writeReg(address, value) {
    let addrAdd = this.sqr1 ? 0 : 4;
    if (address === 0x4000 + addrAdd) {
      // Volume/Envelope decay:
      this.envDecayDisable = (value & 0x10) !== 0;
      this.envDecayRate = value & 0xf;
      this.envDecayLoopEnable = (value & 0x20) !== 0;
      this.dutyMode = (value >> 6) & 0x3;
      this.lengthCounterEnable = (value & 0x20) === 0;
      if (this.envDecayDisable) {
        this.masterVolume = this.envDecayRate;
      } else {
        this.masterVolume = this.envVolume;
      }
      this.updateSampleValue();
    } else if (address === 0x4001 + addrAdd) {
      // Sweep:
      this.sweepActive = (value & 0x80) !== 0;
      this.sweepCounterMax = (value >> 4) & 7;
      this.sweepMode = (value >> 3) & 1;
      this.sweepShiftAmount = value & 7;
      this.updateSweepPeriod = true;
    } else if (address === 0x4002 + addrAdd) {
      // Programmable timer:
      this.progTimerMax &= 0x700;
      this.progTimerMax |= value;
    } else if (address === 0x4003 + addrAdd) {
      // Programmable timer, length counter
      this.progTimerMax &= 0xff;
      this.progTimerMax |= (value & 0x7) << 8;

      if (this.isEnabled) {
        this.lengthCounter = this.papu.getLengthMax(value & 0xf8);
      }

      this.envReset = true;
    }
  }

  setEnabled(value) {
    this.isEnabled = value;
    if (!value) {
      this.lengthCounter = 0;
    }
    this.updateSampleValue();
  }

  getLengthStatus() {
    return this.lengthCounter === 0 || !this.isEnabled ? 0 : 1;
  }

  toJSON() {
    return toJSON(this);
  }

  fromJSON(s) {
    fromJSON(this, s);
  }

  static JSON_PROPERTIES = [
    "isEnabled",
    "lengthCounterEnable",
    "sweepActive",
    "envDecayDisable",
    "envDecayLoopEnable",
    "envReset",
    "sweepCarry",
    "updateSweepPeriod",
    "progTimerCount",
    "progTimerMax",
    "lengthCounter",
    "squareCounter",
    "sweepCounter",
    "sweepCounterMax",
    "sweepMode",
    "sweepShiftAmount",
    "envDecayRate",
    "envDecayCounter",
    "envVolume",
    "masterVolume",
    "dutyMode",
    "sweepResult",
    "sampleValue",
    "vol",
  ];
}

/* harmony default export */ const channel_square = (ChannelSquare);

;// ./src/papu/channel-triangle.js


class ChannelTriangle {
  constructor(papu) {
    this.papu = papu;

    this.progTimerCount = 0;
    this.progTimerMax = 0;
    this.triangleCounter = 0;
    this.isEnabled = false;
    this.sampleCondition = false;
    this.lengthCounter = 0;
    this.lengthCounterEnable = false;
    this.linearCounter = 0;
    this.lcLoadValue = 0;
    this.lcHalt = true;
    this.lcControl = false;
    this.tmp = 0;
    this.sampleValue = 0xf;
  }

  clockLengthCounter() {
    if (this.lengthCounterEnable && this.lengthCounter > 0) {
      this.lengthCounter--;
      if (this.lengthCounter === 0) {
        this.updateSampleCondition();
      }
    }
  }

  clockLinearCounter() {
    if (this.lcHalt) {
      // Load:
      this.linearCounter = this.lcLoadValue;
      this.updateSampleCondition();
    } else if (this.linearCounter > 0) {
      // Decrement:
      this.linearCounter--;
      this.updateSampleCondition();
    }
    if (!this.lcControl) {
      // Clear halt flag:
      this.lcHalt = false;
    }
  }

  getLengthStatus() {
    return this.lengthCounter === 0 || !this.isEnabled ? 0 : 1;
  }

  // eslint-disable-next-line no-unused-vars
  readReg(address) {
    return 0;
  }

  writeReg(address, value) {
    if (address === 0x4008) {
      // New values for linear counter:
      this.lcControl = (value & 0x80) !== 0;
      this.lcLoadValue = value & 0x7f;

      // Length counter enable:
      this.lengthCounterEnable = !this.lcControl;
    } else if (address === 0x400a) {
      // Programmable timer:
      this.progTimerMax &= 0x700;
      this.progTimerMax |= value;
    } else if (address === 0x400b) {
      // Programmable timer, length counter
      this.progTimerMax &= 0xff;
      this.progTimerMax |= (value & 0x07) << 8;
      // Length counter is only loaded when the channel is enabled via $4015.
      // Writing this register while disabled has no effect on the length counter.
      // See https://www.nesdev.org/wiki/APU#Status_($4015)
      if (this.isEnabled) {
        this.lengthCounter = this.papu.getLengthMax(value & 0xf8);
      }
      this.lcHalt = true;
    }

    this.updateSampleCondition();
  }

  clockProgrammableTimer(nCycles) {
    if (this.progTimerMax > 0) {
      this.progTimerCount += nCycles;
      while (
        this.progTimerMax > 0 &&
        this.progTimerCount >= this.progTimerMax
      ) {
        this.progTimerCount -= this.progTimerMax;
        if (
          this.isEnabled &&
          this.lengthCounter > 0 &&
          this.linearCounter > 0
        ) {
          this.clockTriangleGenerator();
        }
      }
    }
  }

  clockTriangleGenerator() {
    this.triangleCounter++;
    this.triangleCounter &= 0x1f;
  }

  setEnabled(value) {
    this.isEnabled = value;
    if (!value) {
      this.lengthCounter = 0;
    }
    this.updateSampleCondition();
  }

  updateSampleCondition() {
    this.sampleCondition =
      this.isEnabled &&
      this.progTimerMax > 7 &&
      this.linearCounter > 0 &&
      this.lengthCounter > 0;
  }

  toJSON() {
    return toJSON(this);
  }

  fromJSON(s) {
    fromJSON(this, s);
  }

  static JSON_PROPERTIES = [
    "isEnabled",
    "sampleCondition",
    "lengthCounterEnable",
    "lcHalt",
    "lcControl",
    "progTimerCount",
    "progTimerMax",
    "triangleCounter",
    "lengthCounter",
    "linearCounter",
    "lcLoadValue",
    "sampleValue",
    "tmp",
  ];
}

/* harmony default export */ const channel_triangle = (ChannelTriangle);

;// ./src/papu/index.js






const CPU_FREQ_NTSC = 1789772.5; //1789772.72727272d;
// const CPU_FREQ_PAL = 1773447.4;

// Frame counter step timing tables (in CPU cycles).
// The APU frame counter fires at these specific cycle positions within each
// sequence. On real hardware, the APU clock is half the CPU clock, so
// these correspond to APU cycles 3728.5, 7456.5, 11185.5, 14914, 14914.5 etc.
// In 4-step mode, the IRQ flag is set 1 CPU cycle before the clock event
// (at 29828 vs 29829), so step 3 is split into two sub-steps.
// See https://www.nesdev.org/wiki/APU_Frame_Counter
const FRAME_STEPS_4 = [7457, 14913, 22371, 29828, 29829];
// 5-step mode step 3 fires at 29829 per the nesdev wiki, not 29828. This is
// fine because fireFrameStep step 3 in 5-step mode is a no-op (no clock or IRQ).
const FRAME_STEPS_5 = [7457, 14913, 22371, 29829, 37281];
const FRAME_PERIOD_4 = 29830; // Total CPU cycles for 4-step sequence
const FRAME_PERIOD_5 = 37282; // Total CPU cycles for 5-step sequence

class PAPU {
  constructor(nes) {
    this.nes = nes;

    this.square1 = new channel_square(this, true);
    this.square2 = new channel_square(this, false);
    this.triangle = new channel_triangle(this);
    this.noise = new channel_noise(this);
    this.dmc = new channel_dm(this);

    this.startedPlaying = false;
    this.recordOutput = false;
    this.triValue = 0;

    // DC removal vars:
    this.prevSampleL = 0;
    this.prevSampleR = 0;
    this.smpAccumL = 0;
    this.smpAccumR = 0;

    // DAC range:
    this.dacRange = 0;
    this.dcValue = 0;

    // Master volume:
    this.masterVolume = 256;

    // Panning:
    this.panning = [80, 170, 100, 150, 128];
    this.setPanning(this.panning);

    // Initialize lookup tables:
    this.initLengthLookup();
    this.initDmcFrequencyLookup();
    this.initNoiseWavelengthLookup();
    this.initDACtables();

    // Init sound registers:
    for (let i = 0; i < 0x14; i++) {
      if (i === 0x10) {
        this.writeReg(0x4010, 0x10);
      } else {
        this.writeReg(0x4000 + i, 0);
      }
    }

    this.sampleRate = this.nes.opts.sampleRate;
    this.sampleTimerMax = Math.floor(
      (1024.0 * CPU_FREQ_NTSC) / this.sampleRate,
    );
    this.sampleTimer = 0;
    this.updateChannelEnable(0);
    this.frameCycleCounter = 0;
    this.frameStep = 0;
    this.countSequence = 0;
    this.sampleCount = 0;
    this.frameIrqEnabled = false;
    this.frameIrqActive = false;
    // Deferred clearing of the frame IRQ flag: on real hardware, reading
    // $4015 doesn't clear bit 6 immediately. The clear takes effect at the
    // next APU "get" cycle (the APU clock runs at half the CPU rate, so
    // get/put phases alternate every CPU cycle). This matters when $4015 is
    // read twice in quick succession (e.g., by the SLO RMW instruction's
    // dummy read + actual read, which are 1 CPU cycle apart). Depending on
    // the APU phase alignment, the second read may or may not still see
    // the flag. See AccuracyCoin test 0x0467 subtests 6 and 7.
    // https://www.nesdev.org/wiki/APU_Frame_Counter
    this.frameIrqClearPending = false;
    // APU cycle parity tracks the CPU cycle count modulo 2, determining
    // which APU half-cycle phase we're on (get or put).
    this.apuCycleParity = 0;
    this.accCount = 0;
    this.smpSquare1 = 0;
    this.smpSquare2 = 0;
    this.smpTriangle = 0;
    this.smpDmc = 0;
    this.channelEnableValue = 0xff;
    this.extraCycles = 0;
    this.maxSample = -500000;
    this.minSample = 500000;
  }

  // eslint-disable-next-line no-unused-vars
  readReg(address) {
    // Read 0x4015:
    let tmp = 0;
    tmp |= this.square1.getLengthStatus();
    tmp |= this.square2.getLengthStatus() << 1;
    tmp |= this.triangle.getLengthStatus() << 2;
    tmp |= this.noise.getLengthStatus() << 3;
    tmp |= this.dmc.getLengthStatus() << 4;
    // Bit 5 is open bus (not driven by APU), comes from CPU data bus
    // See https://www.nesdev.org/wiki/Open_bus_behavior
    tmp |= this.nes.cpu.dataBus & 0x20;
    // Frame interrupt flag: reflects whether the flag is set, regardless of
    // the IRQ inhibit bit in $4017. The inhibit only prevents the IRQ from
    // firing, not the flag from being reported.
    tmp |= (this.frameIrqActive ? 1 : 0) << 6;
    tmp |= this.dmc.getIrqStatus() << 7;

    // Reading $4015 schedules the frame interrupt flag for clearing, but
    // the actual clear is deferred to the next APU "get" cycle. This means
    // if two reads happen 1 CPU cycle apart (e.g., dummy + actual read in
    // an RMW instruction), the second read may still see the flag depending
    // on APU clock phase alignment. The DMC interrupt flag is NOT cleared.
    // Only schedule a clear when the flag is actually set; otherwise a stale
    // pending clear could race with a future fireFrameStep that sets the flag.
    // See https://www.nesdev.org/wiki/APU#Status_($4015)
    if (this.frameIrqActive) {
      this.frameIrqClearPending = true;
    }

    return tmp & 0xff;
  }

  writeReg(address, value) {
    if (address >= 0x4000 && address < 0x4004) {
      // Square Wave 1 Control
      this.square1.writeReg(address, value);
      // console.log("Square Write");
    } else if (address >= 0x4004 && address < 0x4008) {
      // Square 2 Control
      this.square2.writeReg(address, value);
    } else if (address >= 0x4008 && address < 0x400c) {
      // Triangle Control
      this.triangle.writeReg(address, value);
    } else if (address >= 0x400c && address <= 0x400f) {
      // Noise Control
      this.noise.writeReg(address, value);
    } else if (address === 0x4010) {
      // DMC Play mode & DMA frequency
      this.dmc.writeReg(address, value);
    } else if (address === 0x4011) {
      // DMC Delta Counter
      this.dmc.writeReg(address, value);
    } else if (address === 0x4012) {
      // DMC Play code starting address
      this.dmc.writeReg(address, value);
    } else if (address === 0x4013) {
      // DMC Play code length
      this.dmc.writeReg(address, value);
    } else if (address === 0x4015) {
      // Channel enable
      this.updateChannelEnable(value);

      // DMC/IRQ Status
      this.dmc.writeReg(address, value);
    } else if (address === 0x4017) {
      // Frame counter control
      // Bit 7: sequence mode (0=4-step, 1=5-step)
      // Bit 6: IRQ inhibit (0=IRQs enabled, 1=IRQs disabled)
      // See https://www.nesdev.org/wiki/APU_Frame_Counter
      this.countSequence = (value >> 7) & 1;
      // Writing $4017 resets the frame counter's internal divider, but on
      // real hardware the reset is delayed after the write cycle. The delay
      // depends on the APU clock phase at the write:
      //   "get" phase (odd parity): reset after 3 CPU cycles
      //   "put" phase (even parity): reset after 4 CPU cycles
      // Since the emulator clocks the full STA instruction's cycles (4 for
      // STA absolute) after writeReg, we compensate by starting the counter
      // negative so it reaches 0 at the true reset point.
      // See https://www.nesdev.org/wiki/APU_Frame_Counter
      let cpu = this.nes.cpu;
      let pendingCycles = cpu.instrBusCycles + 1 - cpu.apuCatchupCycles;
      let writeParity = (this.apuCycleParity + pendingCycles) & 1;
      // "get" phase (odd): -6 → after STA (4 cycles) → -2, after 2 cycles → 0
      // "put" phase (even): -7 → after STA (4 cycles) → -3, after 3 cycles → 0
      this.frameCycleCounter = -7 + writeParity;
      this.frameStep = 0;

      if (value & 0x40) {
        // IRQ inhibit set: clear the frame interrupt flag and prevent
        // future frame IRQs from firing
        this.frameIrqEnabled = false;
        this.frameIrqActive = false;
        this.frameIrqClearPending = false;
      } else {
        // IRQ inhibit clear: enable frame IRQs (flag is not affected)
        this.frameIrqEnabled = true;
      }

      if (this.countSequence === 1) {
        // 5-step mode: immediately clock all quarter-frame and half-frame
        // units on the write cycle
        this.clockQuarterFrame();
        this.clockHalfFrame();
      }
    }
  }

  // Updates channel enable status.
  // This is done on writes to the
  // channel enable register (0x4015),
  // and when the user enables/disables channels
  // in the GUI.
  updateChannelEnable(value) {
    this.channelEnableValue = value & 0xffff;
    this.square1.setEnabled((value & 1) !== 0);
    this.square2.setEnabled((value & 2) !== 0);
    this.triangle.setEnabled((value & 4) !== 0);
    this.noise.setEnabled((value & 8) !== 0);
    this.dmc.setEnabled((value & 16) !== 0);
  }

  // Clocks all APU channel timers and the frame counter by nCycles CPU cycles.
  // Called once per instruction from the frame loop with the total cycle count.
  // frameCounterAlreadyAdvanced is the number of frame counter cycles already
  // advanced mid-instruction by APU catch-up (advanceFrameCounter). This is
  // subtracted from the frame counter portion only, not from channel timers.
  clockFrameCounter(nCycles, frameCounterAlreadyAdvanced) {
    let frameCounterCycles = nCycles - (frameCounterAlreadyAdvanced || 0);

    // Process deferred frame IRQ clear and update APU cycle parity for
    // the remaining cycles not yet advanced by advanceFrameCounter.
    this.processFrameIrqClear(frameCounterCycles);
    this.apuCycleParity = (this.apuCycleParity + frameCounterCycles) & 1;

    // Don't process channel ticks beyond next sampling:
    nCycles += this.extraCycles;
    let maxCycles = this.sampleTimerMax - this.sampleTimer;
    if (nCycles << 10 > maxCycles) {
      this.extraCycles = ((nCycles << 10) - maxCycles) >> 10;
      nCycles -= this.extraCycles;
    } else {
      this.extraCycles = 0;
    }

    let dmc = this.dmc;
    let triangle = this.triangle;
    let square1 = this.square1;
    let square2 = this.square2;
    let noise = this.noise;

    // Clock DMC:
    if (dmc.isEnabled) {
      dmc.shiftCounter -= nCycles << 3;
      while (dmc.shiftCounter <= 0 && dmc.dmaFrequency > 0) {
        dmc.shiftCounter += dmc.dmaFrequency;
        dmc.clockDmc();
      }
    }

    // Clock Triangle channel Prog timer:
    if (triangle.progTimerMax > 0) {
      triangle.progTimerCount -= nCycles;
      while (triangle.progTimerCount <= 0) {
        triangle.progTimerCount += triangle.progTimerMax + 1;
        if (triangle.linearCounter > 0 && triangle.lengthCounter > 0) {
          triangle.triangleCounter++;
          triangle.triangleCounter &= 0x1f;

          if (triangle.isEnabled) {
            if (triangle.triangleCounter >= 0x10) {
              // Normal value.
              triangle.sampleValue = triangle.triangleCounter & 0xf;
            } else {
              // Inverted value.
              triangle.sampleValue = 0xf - (triangle.triangleCounter & 0xf);
            }
            triangle.sampleValue <<= 4;
          }
        }
      }
    }

    // Clock Square channel 1 Prog timer:
    square1.progTimerCount -= nCycles;
    if (square1.progTimerCount <= 0) {
      square1.progTimerCount += (square1.progTimerMax + 1) << 1;

      square1.squareCounter++;
      square1.squareCounter &= 0x7;
      square1.updateSampleValue();
    }

    // Clock Square channel 2 Prog timer:
    square2.progTimerCount -= nCycles;
    if (square2.progTimerCount <= 0) {
      square2.progTimerCount += (square2.progTimerMax + 1) << 1;

      square2.squareCounter++;
      square2.squareCounter &= 0x7;
      square2.updateSampleValue();
    }

    // Clock noise channel Prog timer:
    let acc_c = nCycles;
    if (noise.progTimerCount - acc_c > 0) {
      // Do all cycles at once:
      noise.progTimerCount -= acc_c;
      noise.accCount += acc_c;
      noise.accValue += acc_c * noise.sampleValue;
    } else {
      // Slow-step:
      while (acc_c-- > 0) {
        if (--noise.progTimerCount <= 0 && noise.progTimerMax > 0) {
          // Update noise shift register:
          noise.shiftReg <<= 1;
          noise.tmp =
            ((noise.shiftReg << (noise.randomMode === 0 ? 1 : 6)) ^
              noise.shiftReg) &
            0x8000;
          if (noise.tmp !== 0) {
            // Sample value must be 0.
            noise.shiftReg |= 0x01;
            noise.randomBit = 0;
            noise.sampleValue = 0;
          } else {
            // Find sample value:
            noise.randomBit = 1;
            if (noise.isEnabled && noise.lengthCounter > 0) {
              noise.sampleValue = noise.masterVolume;
            } else {
              noise.sampleValue = 0;
            }
          }

          noise.progTimerCount += noise.progTimerMax;
        }

        noise.accValue += noise.sampleValue;
        noise.accCount++;
      }
    }

    // Frame IRQ handling:
    if (this.frameIrqEnabled && this.frameIrqActive) {
      this.nes.cpu.requestIrq(this.nes.cpu.IRQ_NORMAL);
    }

    // Clock frame counter: fire steps at the correct CPU cycle positions.
    // Uses the uncapped cycle count to maintain accurate timing.
    this._advanceFrameSteps(frameCounterCycles);

    // Accumulate sample value:
    this.accSample(nCycles);

    // Clock sample timer:
    this.sampleTimer += nCycles << 10;
    if (this.sampleTimer >= this.sampleTimerMax) {
      // Sample channels:
      this.sample();
      this.sampleTimer -= this.sampleTimerMax;
    }
  }

  // Process the deferred frame IRQ flag clear. On real hardware, reading
  // $4015 schedules the clear for the next APU "get" cycle (which happens
  // every 2 CPU cycles). If the current APU phase is "put" (parity 0),
  // the next "get" is 1 cycle away. If "get" (parity 1), it's 2 cycles
  // away. This must be called BEFORE updating apuCycleParity for the
  // current advance, so it sees the parity at the start of the period.
  // See https://www.nesdev.org/wiki/APU_Frame_Counter
  processFrameIrqClear(nCycles) {
    if (!this.frameIrqClearPending || nCycles <= 0) return;
    // Determine how many CPU cycles until the next APU "get" boundary.
    let cyclesToNextGet = (this.apuCycleParity & 1) === 0 ? 1 : 2;
    if (nCycles >= cyclesToNextGet) {
      this.frameIrqActive = false;
      this.frameIrqClearPending = false;
    }
  }

  // Advance only the frame counter steps without clocking channel timers,
  // DMC, or audio sampling. Used by CPU APU catch-up to update frame counter
  // state (length counters, envelopes) before $4015 reads, without disturbing
  // DMC DMA timing or audio generation.
  advanceFrameCounter(nCycles) {
    this.processFrameIrqClear(nCycles);
    this.apuCycleParity = (this.apuCycleParity + nCycles) & 1;
    this._advanceFrameSteps(nCycles);
  }

  // Advance frame counter steps and handle period wrap. Shared by both
  // clockFrameCounter (full APU tick) and advanceFrameCounter (catch-up only).
  // The step loop and period wrap are separated: steps fire when the counter
  // reaches each step's cycle position, and the period wrap only occurs when
  // the counter reaches the full period length (not immediately after the
  // last step). This matters because in 4-step mode, the last step fires at
  // 29829 but the period wrap (and 3rd IRQ assertion) occurs at 29830.
  // See https://www.nesdev.org/wiki/APU_Frame_Counter
  _advanceFrameSteps(frameCounterCycles) {
    this.frameCycleCounter += frameCounterCycles;
    let steps = this.countSequence === 0 ? FRAME_STEPS_4 : FRAME_STEPS_5;
    let period = this.countSequence === 0 ? FRAME_PERIOD_4 : FRAME_PERIOD_5;
    for (;;) {
      if (
        this.frameStep < steps.length &&
        this.frameCycleCounter >= steps[this.frameStep]
      ) {
        this.fireFrameStep(this.frameStep);
        this.frameStep++;
      } else if (
        this.frameStep >= steps.length &&
        this.frameCycleCounter >= period
      ) {
        // Period wrap: reset the frame counter for the next sequence.
        this.frameStep = 0;
        this.frameCycleCounter -= period;
        // In 4-step mode, the IRQ flag is asserted for 3 consecutive CPU
        // cycles: at 29828 (step 3), 29829 (step 4), and 29830 (period wrap).
        // On the 3rd cycle (period wrap), the flag is set only if the IRQ
        // inhibit flag is clear. If inhibit is set, the flag is actively
        // cleared (it was unconditionally set on cycles 29828-29829).
        // See https://www.nesdev.org/wiki/APU_Frame_Counter
        if (this.countSequence === 0) {
          this.frameIrqActive = this.frameIrqEnabled;
          this.frameIrqClearPending = false;
        }
      } else {
        break;
      }
    }
  }

  accSample(cycles) {
    // Special treatment for triangle channel - need to interpolate.
    if (this.triangle.sampleCondition) {
      this.triValue = Math.floor(
        (this.triangle.progTimerCount << 4) / (this.triangle.progTimerMax + 1),
      );
      if (this.triValue > 16) {
        this.triValue = 16;
      }
      if (this.triangle.triangleCounter >= 16) {
        this.triValue = 16 - this.triValue;
      }

      // Add non-interpolated sample value:
      this.triValue += this.triangle.sampleValue;
    }

    // Now sample normally:
    if (cycles === 2) {
      this.smpTriangle += this.triValue << 1;
      this.smpDmc += this.dmc.sample << 1;
      this.smpSquare1 += this.square1.sampleValue << 1;
      this.smpSquare2 += this.square2.sampleValue << 1;
      this.accCount += 2;
    } else if (cycles === 4) {
      this.smpTriangle += this.triValue << 2;
      this.smpDmc += this.dmc.sample << 2;
      this.smpSquare1 += this.square1.sampleValue << 2;
      this.smpSquare2 += this.square2.sampleValue << 2;
      this.accCount += 4;
    } else {
      this.smpTriangle += cycles * this.triValue;
      this.smpDmc += cycles * this.dmc.sample;
      this.smpSquare1 += cycles * this.square1.sampleValue;
      this.smpSquare2 += cycles * this.square2.sampleValue;
      this.accCount += cycles;
    }
  }

  // Fire a frame counter step. Each step clocks different APU units depending
  // on the mode and step number.
  // See https://www.nesdev.org/wiki/APU_Frame_Counter
  fireFrameStep(step) {
    if (this.countSequence === 0) {
      // Mode 0 (4-step):
      //   Step 0 (7457): quarter frame (envelope + linear counter)
      //   Step 1 (14913): half frame (quarter + length counter + sweep)
      //   Step 2 (22371): quarter frame
      //   Step 3 (29828): set frame IRQ flag only (1 cycle before clock)
      //   Step 4 (29829): half frame + set frame IRQ flag
      // On real hardware, the IRQ flag is asserted 1 CPU cycle before the
      // clock event at the end of the 4-step sequence. This is why step 3
      // is split from step 4.
      // See https://www.nesdev.org/wiki/APU_Frame_Counter
      switch (step) {
        case 0:
          this.clockQuarterFrame();
          break;
        case 1:
          this.clockQuarterFrame();
          this.clockHalfFrame();
          break;
        case 2:
          this.clockQuarterFrame();
          break;
        case 3:
          // IRQ flag is UNCONDITIONALLY set 1 CPU cycle before the half-frame
          // clock, regardless of the IRQ inhibit flag ($4017 bit 6). On real
          // hardware, the flag is driven high by the frame counter output for
          // cycles 29828-29829 even when inhibit is set; only the period wrap
          // at 29830 respects the inhibit flag. Cancel any pending deferred
          // clear since the flag is being re-asserted by hardware.
          // See AccuracyCoin tests I-L.
          this.frameIrqActive = true;
          this.frameIrqClearPending = false;
          break;
        case 4:
          this.clockQuarterFrame();
          this.clockHalfFrame();
          // IRQ flag continues to be unconditionally asserted on this cycle.
          this.frameIrqActive = true;
          this.frameIrqClearPending = false;
          break;
      }
    } else {
      // Mode 1 (5-step):
      //   Step 0: quarter frame
      //   Step 1: half frame
      //   Step 2: quarter frame
      //   Step 3: nothing (no clocking, no IRQ)
      //   Step 4: half frame
      switch (step) {
        case 0:
          this.clockQuarterFrame();
          break;
        case 1:
          this.clockQuarterFrame();
          this.clockHalfFrame();
          break;
        case 2:
          this.clockQuarterFrame();
          break;
        case 3:
          // Nothing happens at step 4 in 5-step mode
          break;
        case 4:
          this.clockQuarterFrame();
          this.clockHalfFrame();
          break;
      }
    }
  }

  // Quarter frame: clock envelopes and triangle linear counter (~240Hz)
  clockQuarterFrame() {
    this.square1.clockEnvDecay();
    this.square2.clockEnvDecay();
    this.noise.clockEnvDecay();
    this.triangle.clockLinearCounter();
  }

  // Half frame: clock length counters and sweep units (~120Hz)
  clockHalfFrame() {
    this.triangle.clockLengthCounter();
    this.square1.clockLengthCounter();
    this.square2.clockLengthCounter();
    this.noise.clockLengthCounter();
    this.square1.clockSweep();
    this.square2.clockSweep();
  }

  // Samples the channels, mixes the output together, then writes to buffer.
  sample() {
    let sq_index, tnd_index;

    if (this.accCount > 0) {
      this.smpSquare1 <<= 4;
      this.smpSquare1 = Math.floor(this.smpSquare1 / this.accCount);

      this.smpSquare2 <<= 4;
      this.smpSquare2 = Math.floor(this.smpSquare2 / this.accCount);

      this.smpTriangle = Math.floor(this.smpTriangle / this.accCount);

      this.smpDmc <<= 4;
      this.smpDmc = Math.floor(this.smpDmc / this.accCount);

      this.accCount = 0;
    } else {
      this.smpSquare1 = this.square1.sampleValue << 4;
      this.smpSquare2 = this.square2.sampleValue << 4;
      this.smpTriangle = this.triangle.sampleValue;
      this.smpDmc = this.dmc.sample << 4;
    }

    let smpNoise = Math.floor((this.noise.accValue << 4) / this.noise.accCount);
    this.noise.accValue = smpNoise >> 4;
    this.noise.accCount = 1;

    // Stereo sound.

    // Left channel:
    sq_index =
      (this.smpSquare1 * this.stereoPosLSquare1 +
        this.smpSquare2 * this.stereoPosLSquare2) >>
      8;
    tnd_index =
      (3 * this.smpTriangle * this.stereoPosLTriangle +
        (smpNoise << 1) * this.stereoPosLNoise +
        this.smpDmc * this.stereoPosLDMC) >>
      8;
    if (sq_index >= this.square_table.length) {
      sq_index = this.square_table.length - 1;
    }
    if (tnd_index >= this.tnd_table.length) {
      tnd_index = this.tnd_table.length - 1;
    }
    let sampleValueL =
      this.square_table[sq_index] + this.tnd_table[tnd_index] - this.dcValue;

    // Right channel:
    sq_index =
      (this.smpSquare1 * this.stereoPosRSquare1 +
        this.smpSquare2 * this.stereoPosRSquare2) >>
      8;
    tnd_index =
      (3 * this.smpTriangle * this.stereoPosRTriangle +
        (smpNoise << 1) * this.stereoPosRNoise +
        this.smpDmc * this.stereoPosRDMC) >>
      8;
    if (sq_index >= this.square_table.length) {
      sq_index = this.square_table.length - 1;
    }
    if (tnd_index >= this.tnd_table.length) {
      tnd_index = this.tnd_table.length - 1;
    }
    let sampleValueR =
      this.square_table[sq_index] + this.tnd_table[tnd_index] - this.dcValue;

    // Remove DC from left channel:
    let smpDiffL = sampleValueL - this.prevSampleL;
    this.prevSampleL += smpDiffL;
    this.smpAccumL += smpDiffL - (this.smpAccumL >> 10);
    sampleValueL = this.smpAccumL;

    // Remove DC from right channel:
    let smpDiffR = sampleValueR - this.prevSampleR;
    this.prevSampleR += smpDiffR;
    this.smpAccumR += smpDiffR - (this.smpAccumR >> 10);
    sampleValueR = this.smpAccumR;

    // Write:
    if (sampleValueL > this.maxSample) {
      this.maxSample = sampleValueL;
    }
    if (sampleValueL < this.minSample) {
      this.minSample = sampleValueL;
    }

    if (this.nes.opts.onAudioSample) {
      this.nes.opts.onAudioSample(sampleValueL / 32768, sampleValueR / 32768);
    }

    // Reset sampled values:
    this.smpSquare1 = 0;
    this.smpSquare2 = 0;
    this.smpTriangle = 0;
    this.smpDmc = 0;
  }

  getLengthMax(value) {
    return this.lengthLookup[value >> 3];
  }

  getDmcFrequency(value) {
    if (value >= 0 && value < 0x10) {
      return this.dmcFreqLookup[value];
    }
    return 0;
  }

  getNoiseWaveLength(value) {
    if (value >= 0 && value < 0x10) {
      return this.noiseWavelengthLookup[value];
    }
    return 0;
  }

  // Recalculate the sample timer for a non-standard host frame rate.
  // At 60fps the timer fires once per (CPU_FREQ / sampleRate) cycles. If the
  // host calls frame() at a different rate, scale proportionally so the total
  // audio output per second stays constant.
  setFrameRate(rate) {
    this.sampleTimerMax = Math.floor(
      (1024.0 * CPU_FREQ_NTSC * rate) / (this.sampleRate * 60.0),
    );
  }

  setPanning(pos) {
    for (let i = 0; i < 5; i++) {
      this.panning[i] = pos[i];
    }
    this.updateStereoPos();
  }

  setMasterVolume(value) {
    if (value < 0) {
      value = 0;
    }
    if (value > 256) {
      value = 256;
    }
    this.masterVolume = value;
    this.updateStereoPos();
  }

  updateStereoPos() {
    this.stereoPosLSquare1 = (this.panning[0] * this.masterVolume) >> 8;
    this.stereoPosLSquare2 = (this.panning[1] * this.masterVolume) >> 8;
    this.stereoPosLTriangle = (this.panning[2] * this.masterVolume) >> 8;
    this.stereoPosLNoise = (this.panning[3] * this.masterVolume) >> 8;
    this.stereoPosLDMC = (this.panning[4] * this.masterVolume) >> 8;

    this.stereoPosRSquare1 = this.masterVolume - this.stereoPosLSquare1;
    this.stereoPosRSquare2 = this.masterVolume - this.stereoPosLSquare2;
    this.stereoPosRTriangle = this.masterVolume - this.stereoPosLTriangle;
    this.stereoPosRNoise = this.masterVolume - this.stereoPosLNoise;
    this.stereoPosRDMC = this.masterVolume - this.stereoPosLDMC;
  }

  initLengthLookup() {
    // prettier-ignore
    this.lengthLookup = [
            0x0A, 0xFE,
            0x14, 0x02,
            0x28, 0x04,
            0x50, 0x06,
            0xA0, 0x08,
            0x3C, 0x0A,
            0x0E, 0x0C,
            0x1A, 0x0E,
            0x0C, 0x10,
            0x18, 0x12,
            0x30, 0x14,
            0x60, 0x16,
            0xC0, 0x18,
            0x48, 0x1A,
            0x10, 0x1C,
            0x20, 0x1E
        ];
  }

  initDmcFrequencyLookup() {
    this.dmcFreqLookup = new Array(16);

    this.dmcFreqLookup[0x0] = 0xd60;
    this.dmcFreqLookup[0x1] = 0xbe0;
    this.dmcFreqLookup[0x2] = 0xaa0;
    this.dmcFreqLookup[0x3] = 0xa00;
    this.dmcFreqLookup[0x4] = 0x8f0;
    this.dmcFreqLookup[0x5] = 0x7f0;
    this.dmcFreqLookup[0x6] = 0x710;
    this.dmcFreqLookup[0x7] = 0x6b0;
    this.dmcFreqLookup[0x8] = 0x5f0;
    this.dmcFreqLookup[0x9] = 0x500;
    this.dmcFreqLookup[0xa] = 0x470;
    this.dmcFreqLookup[0xb] = 0x400;
    this.dmcFreqLookup[0xc] = 0x350;
    this.dmcFreqLookup[0xd] = 0x2a0;
    this.dmcFreqLookup[0xe] = 0x240;
    this.dmcFreqLookup[0xf] = 0x1b0;
    //for(int i=0;i<16;i++)dmcFreqLookup[i]/=8;
  }

  initNoiseWavelengthLookup() {
    this.noiseWavelengthLookup = new Array(16);

    this.noiseWavelengthLookup[0x0] = 0x004;
    this.noiseWavelengthLookup[0x1] = 0x008;
    this.noiseWavelengthLookup[0x2] = 0x010;
    this.noiseWavelengthLookup[0x3] = 0x020;
    this.noiseWavelengthLookup[0x4] = 0x040;
    this.noiseWavelengthLookup[0x5] = 0x060;
    this.noiseWavelengthLookup[0x6] = 0x080;
    this.noiseWavelengthLookup[0x7] = 0x0a0;
    this.noiseWavelengthLookup[0x8] = 0x0ca;
    this.noiseWavelengthLookup[0x9] = 0x0fe;
    this.noiseWavelengthLookup[0xa] = 0x17c;
    this.noiseWavelengthLookup[0xb] = 0x1fc;
    this.noiseWavelengthLookup[0xc] = 0x2fa;
    this.noiseWavelengthLookup[0xd] = 0x3f8;
    this.noiseWavelengthLookup[0xe] = 0x7f2;
    this.noiseWavelengthLookup[0xf] = 0xfe4;
  }

  initDACtables() {
    let value, ival, i;
    let max_sqr = 0;
    let max_tnd = 0;

    this.square_table = new Array(32 * 16);
    this.tnd_table = new Array(204 * 16);

    for (i = 0; i < 32 * 16; i++) {
      value = 95.52 / (8128.0 / (i / 16.0) + 100.0);
      value *= 0.98411;
      value *= 50000.0;
      ival = Math.floor(value);

      this.square_table[i] = ival;
      if (ival > max_sqr) {
        max_sqr = ival;
      }
    }

    for (i = 0; i < 204 * 16; i++) {
      value = 163.67 / (24329.0 / (i / 16.0) + 100.0);
      value *= 0.98411;
      value *= 50000.0;
      ival = Math.floor(value);

      this.tnd_table[i] = ival;
      if (ival > max_tnd) {
        max_tnd = ival;
      }
    }

    this.dacRange = max_sqr + max_tnd;
    this.dcValue = this.dacRange / 2;
  }

  toJSON() {
    let obj = toJSON(this);
    obj.dmc = this.dmc.toJSON();
    obj.noise = this.noise.toJSON();
    obj.square1 = this.square1.toJSON();
    obj.square2 = this.square2.toJSON();
    obj.triangle = this.triangle.toJSON();
    return obj;
  }

  fromJSON(s) {
    fromJSON(this, s);
    this.dmc.fromJSON(s.dmc);
    this.noise.fromJSON(s.noise);
    this.square1.fromJSON(s.square1);
    this.square2.fromJSON(s.square2);
    this.triangle.fromJSON(s.triangle);
  }

  static JSON_PROPERTIES = [
    "channelEnableValue",
    "sampleRate",
    "frameIrqEnabled",
    "frameIrqActive",
    "frameIrqClearPending",
    "apuCycleParity",
    "startedPlaying",
    "recordOutput",
    "frameCycleCounter",
    "frameStep",
    "countSequence",
    "sampleTimer",
    "sampleTimerMax",
    "sampleCount",
    "triValue",
    "smpSquare1",
    "smpSquare2",
    "smpTriangle",
    "smpDmc",
    "accCount",
    "prevSampleL",
    "prevSampleR",
    "smpAccumL",
    "smpAccumR",
    "masterVolume",
    "stereoPosLSquare1",
    "stereoPosLSquare2",
    "stereoPosLTriangle",
    "stereoPosLNoise",
    "stereoPosLDMC",
    "stereoPosRSquare1",
    "stereoPosRSquare2",
    "stereoPosRTriangle",
    "stereoPosRNoise",
    "stereoPosRDMC",
    "extraCycles",
    "maxSample",
    "minSample",
    "panning",
  ];
}

/* harmony default export */ const papu = (PAPU);

;// ./src/gamegenie.js
const LETTER_VALUES = "APZLGITYEOXUKSVN";

function toDigit(letter) {
  return LETTER_VALUES.indexOf(letter);
}

function toLetter(digit) {
  return LETTER_VALUES[digit];
}

function toHex(n, width) {
  const s = n.toString(16);
  return "0000".substring(0, width - s.length) + s;
}

class GameGenie {
  constructor() {
    this.patches = [];
    this.enabled = true;
    // Callback invoked when patches or enabled state change, so the CPU
    // can swap its loadFromCartridge function pointer. Set by NES after
    // construction.
    this.onChange = null;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (this.onChange) this.onChange();
  }

  addCode(code) {
    const patch = this.decode(code);
    if (!patch) {
      throw new Error(`Invalid Game Genie code: ${code}`);
    }
    this.patches.push(patch);
    if (this.onChange) this.onChange();
  }

  addPatch(addr, value, key) {
    this.patches.push({ addr, value, key });
    if (this.onChange) this.onChange();
  }

  removeAllCodes() {
    this.patches = [];
    if (this.onChange) this.onChange();
  }

  // Apply Game Genie patches to a value being read from the given address.
  // Game Genie works by intercepting ROM reads and substituting values.
  // The address is masked to 15 bits because Game Genie ignores the
  // highest bit (ROM is mirrored in $8000-$FFFF).
  applyCodes(addr, value) {
    if (!this.enabled) return value;

    for (let i = 0; i < this.patches.length; ++i) {
      if (this.patches[i].addr === (addr & 0x7fff)) {
        if (
          this.patches[i].key === undefined ||
          this.patches[i].key === value
        ) {
          return this.patches[i].value;
        }
      }
    }
    return value;
  }

  decode(code) {
    if (code.includes(":")) return this.decodeHex(code);

    const digits = code.toUpperCase().split("").map(toDigit);

    let value =
      ((digits[0] & 8) << 4) + ((digits[1] & 7) << 4) + (digits[0] & 7);
    const addr =
      ((digits[3] & 7) << 12) +
      ((digits[4] & 8) << 8) +
      ((digits[5] & 7) << 8) +
      ((digits[1] & 8) << 4) +
      ((digits[2] & 7) << 4) +
      (digits[3] & 8) +
      (digits[4] & 7);
    let key;

    if (digits.length === 8) {
      value += digits[7] & 8;
      key =
        ((digits[6] & 8) << 4) +
        ((digits[7] & 7) << 4) +
        (digits[5] & 8) +
        (digits[6] & 7);
    } else {
      value += digits[5] & 8;
    }

    const wantskey = !!(digits[2] >> 3);

    return { value, addr, wantskey, key };
  }

  encodeHex(addr, value, key, wantskey) {
    let s = toHex(addr, 4) + ":" + toHex(value, 2);

    if (key !== undefined || wantskey) {
      s += "?";
    }

    if (key !== undefined) {
      s += toHex(key, 2);
    }

    return s;
  }

  decodeHex(s) {
    const match = s.match(/([0-9a-fA-F]+):([0-9a-fA-F]+)(\?[0-9a-fA-F]*)?/);
    if (!match) return null;

    const addr = parseInt(match[1], 16);
    const value = parseInt(match[2], 16);
    const wantskey = match[3] !== undefined;
    const key =
      match[3] !== undefined && match[3].length > 1
        ? parseInt(match[3].substring(1), 16)
        : undefined;

    return { value, addr, wantskey, key };
  }

  encode(addr, value, key, wantskey) {
    const digits = Array(6);

    digits[0] = (value & 7) + ((value >> 4) & 8);
    digits[1] = ((value >> 4) & 7) + ((addr >> 4) & 8);
    digits[2] = (addr >> 4) & 7;
    digits[3] = (addr >> 12) + (addr & 8);
    digits[4] = (addr & 7) + ((addr >> 8) & 8);
    digits[5] = (addr >> 8) & 7;

    if (key === undefined) {
      digits[5] += value & 8;
      if (wantskey) digits[2] += 8;
    } else {
      digits[2] += 8;
      digits[5] += key & 8;
      digits[6] = (key & 7) + ((key >> 4) & 8);
      digits[7] = ((key >> 4) & 7) + (value & 8);
    }

    const code = digits.map(toLetter).join("");

    return code;
  }
}

/* harmony default export */ const gamegenie = (GameGenie);

;// ./src/mappers/mapper0.js


// NROM - the simplest NES cartridge board (NES-NROM-128/NROM-256)
// Used by games like Super Mario Bros., Donkey Kong, Excitebike.
// No bank switching at all: 16 or 32 KB PRG-ROM, 8 KB CHR-ROM, fixed mirroring.
// See https://www.nesdev.org/wiki/NROM
class Mapper0 {
  static mapperName = "NROM";

  constructor(nes) {
    this.nes = nes;

    this.joy1StrobeState = 0;
    this.joy2StrobeState = 0;
    this.joypadLastWrite = 0;
    // The effective OUT0 value visible to the controller shift register.
    // On the 2A03, OUT0-OUT2 are output latches that only update on APU
    // clock edges (every 2 CPU cycles). Writes to $4016 on "get" cycles
    // (odd CPU cycle count) update the internal register but NOT the output
    // latch until the next APU clock. This distinction matters for RMW
    // instructions like DEC $4016 that produce a 1-cycle strobe pulse:
    // the dummy write and final write land on consecutive CPU cycles, and
    // whether the pulse is visible depends on APU clock alignment.
    // See https://www.nesdev.org/wiki/CPU_pin_out_and_signal_timing
    this.joypadOutputBit0 = 0;
    // CPU cycle at which the last $4016 write occurred (-2 = never)
    this.joypadLastWriteCycle = -2;

    this.zapperFired = false;
    this.zapperX = null;
    this.zapperY = null;

    // Set to true by mappers that need per-tile BG override (e.g. MMC5
    // ExRAM mode 1). When true, the PPU calls getBgTileData() for each
    // background tile during rendering.
    this.bgTileOverride = false;
  }

  write(address, value) {
    if (address < 0x2000) {
      // Mirroring of RAM:
      this.nes.cpu.mem[address & 0x7ff] = value;
    } else if (address >= 0x8000) {
      // ROM is not writable. Mappers may override this to handle bank switching.
    } else if (address >= 0x6000) {
      // Cartridge SRAM (0x6000-0x7FFF)
      this.nes.cpu.mem[address] = value;
      this.nes.opts.onBatteryRamWrite(address, value);
    } else if (address > 0x4017) {
      // Cartridge expansion area (0x4018-0x5FFF)
      this.nes.cpu.mem[address] = value;
    } else if (address > 0x2007 && address < 0x4000) {
      this.regWrite(0x2000 + (address & 0x7), value);
    } else {
      this.regWrite(address, value);
    }
  }

  writelow(address, value) {
    if (address < 0x2000) {
      // Mirroring of RAM:
      this.nes.cpu.mem[address & 0x7ff] = value;
    } else if (address >= 0x8000) {
      // ROM is not writable
    } else if (address > 0x4017) {
      // Cartridge RAM/expansion area (0x4018-0x7FFF)
      this.nes.cpu.mem[address] = value;
    } else if (address > 0x2007 && address < 0x4000) {
      this.regWrite(0x2000 + (address & 0x7), value);
    } else {
      this.regWrite(address, value);
    }
  }

  load(address) {
    // Wrap around:
    address &= 0xffff;

    // Check address range:
    if (address > 0x4017) {
      if (address < 0x6000) {
        // Open bus: $4018-$5FFF (unmapped expansion area)
        return this.nes.cpu.dataBus;
      }
      // Cartridge RAM ($6000-$7FFF) and ROM ($8000-$FFFF):
      return this.nes.cpu.mem[address];
    } else if (address >= 0x2000) {
      // I/O Ports.
      return this.regLoad(address);
    } else {
      // RAM (mirrored)
      return this.nes.cpu.mem[address & 0x7ff];
    }
  }

  regLoad(address) {
    switch (
      address >> 12 // use fourth nibble (0xF000)
    ) {
      case 0:
        break;

      case 1:
        break;

      case 2:
      // Fall through to case 3
      case 3:
        // PPU Registers
        switch (address & 0x7) {
          case 0x0:
            // 0x2000: PPU Control Register 1 (write-only, returns open bus)
            return this.nes.ppu.openBusLatch;

          case 0x1:
            // 0x2001: PPU Control Register 2 (write-only, returns open bus)
            return this.nes.ppu.openBusLatch;

          case 0x2:
            // 0x2002: PPU Status Register (bits 7-5 from status, 4-0 from open bus)
            return this.nes.ppu.readStatusRegister();

          case 0x3:
            // 0x2003: OAM Address (write-only, returns open bus)
            return this.nes.ppu.openBusLatch;

          case 0x4:
            // 0x2004: Sprite Memory read
            return this.nes.ppu.sramLoad();

          case 0x5:
            // 0x2005: Scroll (write-only, returns open bus)
            return this.nes.ppu.openBusLatch;

          case 0x6:
            // 0x2006: VRAM Address (write-only, returns open bus)
            return this.nes.ppu.openBusLatch;

          case 0x7:
            // 0x2007: VRAM read
            return this.nes.ppu.vramLoad();
        }
        break;
      case 4:
        // Sound+Joypad registers
        switch (address - 0x4015) {
          case 0:
            // 0x4015:
            // Sound channel enable, DMC Status
            return this.nes.papu.readReg(address);

          case 1:
            // 0x4016:
            // Joystick 1 + Strobe
            // Bits 0-4 from controller, bits 5-7 are open bus (data bus)
            // See https://www.nesdev.org/wiki/Open_bus_behavior
            return (this.joy1Read() & 0x1f) | (this.nes.cpu.dataBus & 0xe0);

          case 2: {
            // 0x4017:
            // Joystick 2 + Strobe
            // https://wiki.nesdev.com/w/index.php/Zapper
            // Bits 0-4 from controller/zapper, bits 5-7 are open bus (data bus)
            // Zapper bits (3=light sensor, 4=trigger) are only driven when the
            // zapper is connected (zapperX/Y non-null). With no zapper, these
            // bits are 0 (standard controller doesn't drive them).
            let w = 0;

            if (this.zapperX !== null && this.zapperY !== null) {
              // Zapper connected: bit 3 = light not detected
              if (!this.nes.ppu.isPixelWhite(this.zapperX, this.zapperY)) {
                w = 0x1 << 3;
              }
            }

            if (this.zapperFired) {
              w |= 0x1 << 4;
            }
            return (
              ((this.joy2Read() | w) & 0x1f) | (this.nes.cpu.dataBus & 0xe0)
            );
          }
        }
        break;
    }
    // Write-only registers (APU $4000-$4014, etc.) are open bus.
    // On real hardware, if a DMC DMA fetch coincides with this read cycle,
    // the DMA steals the CPU bus cycle and the fetched sample byte appears
    // on the data bus instead of the open bus value. This is how the ROM's
    // DMA sync loops (LDA $4000; BNE) detect DMC activity.
    // See https://www.nesdev.org/wiki/APU_DMC#Memory_reader
    let cpu = this.nes.cpu;
    if (
      cpu._dmcFetchCycles > 0 &&
      cpu._dmcFetchCycles === cpu.instrBusCycles + 1
    ) {
      let dmc = this.nes.papu.dmc;
      if (dmc && dmc.isEnabled) {
        return dmc.lastFetchedByte;
      }
    }
    return cpu.dataBus;
  }

  regWrite(address, value) {
    // All PPU register writes update the open bus latch
    if (address >= 0x2000 && address <= 0x3fff) {
      this.nes.ppu.openBusLatch = value;
      this.nes.ppu.openBusDecayFrames = 36; // ~600ms at 60fps
    }

    switch (address) {
      case 0x2000:
        // PPU Control register 1
        this.nes.cpu.mem[address] = value;
        this.nes.ppu.updateControlReg1(value);
        break;

      case 0x2001:
        // PPU Control register 2
        this.nes.cpu.mem[address] = value;
        this.nes.ppu.updateControlReg2(value);
        break;

      case 0x2003:
        // Set Sprite RAM address:
        this.nes.ppu.writeSRAMAddress(value);
        break;

      case 0x2004:
        // Write to Sprite RAM:
        this.nes.ppu.sramWrite(value);
        break;

      case 0x2005:
        // Screen Scroll offsets:
        this.nes.ppu.scrollWrite(value);
        break;

      case 0x2006:
        // Set VRAM address:
        this.nes.ppu.writeVRAMAddress(value);
        break;

      case 0x2007:
        // Write to VRAM:
        this.nes.ppu.vramWrite(value);
        break;

      case 0x4014:
        // Sprite Memory DMA Access
        this.nes.ppu.sramDMA(value);
        break;

      case 0x4015:
        // Sound Channel Switch, DMC Status
        this.nes.papu.writeReg(address, value);
        break;

      case 0x4016: {
        // Joystick 1 + Strobe
        // The 2A03 output ports (OUT0-OUT2) only update on APU clock edges,
        // which happen every 2 CPU cycles. A write to $4016 always updates
        // the internal register immediately, but the effective output
        // (joypadOutputBit0) only changes on odd-parity CPU cycles.
        // This matters for RMW instructions like DEC $4016: the dummy
        // write (original value) and real write (modified value) happen on
        // consecutive cycles. If the dummy write lands on an APU tick
        // (even) but the real write lands on a non-tick (odd), only the
        // dummy write's value reaches OUT0. The AccuracyCoin controller
        // strobe test verifies this behavior.
        let cpu = this.nes.cpu;
        let currentCycle = cpu._cpuCycleBase + cpu.instrBusCycles;

        // If previous write(s) haven't been applied to the output yet
        // (because they landed on odd cycles), sync them now if at least
        // one APU tick has passed since then.
        if (currentCycle - this.joypadLastWriteCycle > 1) {
          let prevBit = this.joypadLastWrite & 1;
          if (prevBit !== this.joypadOutputBit0) {
            if (this.joypadOutputBit0 === 1 && prevBit === 0) {
              this.joy1StrobeState = 0;
              this.joy2StrobeState = 0;
            }
            this.joypadOutputBit0 = prevBit;
          }
        }

        this.joypadLastWrite = value;
        this.joypadLastWriteCycle = currentCycle;

        // Apply to effective output only on APU tick ("put") cycles.
        // After OAM DMA sync, _cpuCycleBase is always odd, so the first
        // instruction cycle (_cpuCycleBase + 1) is even = "get". The 5th
        // cycle of a 6-cycle RMW (dummy write) is _cpuCycleBase + 4 = odd
        // = "put" = APU tick. This matches real hardware where OUT0 updates
        // on "put" cycles.
        if (currentCycle % 2 === 1) {
          let newBit = value & 1;
          if (this.joypadOutputBit0 === 1 && newBit === 0) {
            this.joy1StrobeState = 0;
            this.joy2StrobeState = 0;
          }
          this.joypadOutputBit0 = newBit;
        }
        break;
      }

      case 0x4017:
        // Sound channel frame sequencer:
        this.nes.papu.writeReg(address, value);
        break;

      default:
        // Sound registers
        // console.log("write to sound reg");
        if (address >= 0x4000 && address <= 0x4017) {
          this.nes.papu.writeReg(address, value);
        }
    }
  }

  // Sync any pending $4016 output that was deferred from odd-cycle writes.
  // Called before reads from $4016/$4017, since reads happen on a later
  // cycle and the APU clock will have ticked by then.
  _syncJoypadOutput() {
    let newBit = this.joypadLastWrite & 1;
    if (newBit !== this.joypadOutputBit0) {
      if (this.joypadOutputBit0 === 1 && newBit === 0) {
        this.joy1StrobeState = 0;
        this.joy2StrobeState = 0;
      }
      this.joypadOutputBit0 = newBit;
    }
  }

  joy1Read() {
    // Sync deferred output before checking strobe state
    this._syncJoypadOutput();

    // While strobe is active ($4016 bit 0 = 1), the shift register is
    // continuously reloaded, so reads always return button A's state.
    // See https://www.nesdev.org/wiki/Standard_controller
    if (this.joypadOutputBit0) {
      return this.nes.controllers[1].state[0];
    }

    let ret;
    if (this.joy1StrobeState < 8) {
      ret = this.nes.controllers[1].state[this.joy1StrobeState];
    } else {
      // After 8 reads, the shift register is empty and the serial data
      // line floats high, returning 1 on a standard NES controller.
      ret = 1;
    }

    this.joy1StrobeState++;
    if (this.joy1StrobeState === 24) {
      this.joy1StrobeState = 0;
    }

    return ret;
  }

  joy2Read() {
    // Sync deferred output before checking strobe state
    this._syncJoypadOutput();

    // While strobe is active, always return button A's state.
    if (this.joypadOutputBit0) {
      return this.nes.controllers[2].state[0];
    }

    let ret;
    if (this.joy2StrobeState < 8) {
      ret = this.nes.controllers[2].state[this.joy2StrobeState];
    } else {
      // After 8 reads, the shift register is empty → returns 1.
      ret = 1;
    }

    this.joy2StrobeState++;
    if (this.joy2StrobeState === 24) {
      this.joy2StrobeState = 0;
    }

    return ret;
  }

  loadROM() {
    if (!this.nes.rom.valid || this.nes.rom.romCount < 1) {
      throw new Error("NoMapper: Invalid ROM! Unable to load.");
    }

    // Load ROM into memory:
    this.loadPRGROM();

    // Load CHR-ROM:
    this.loadCHRROM();

    // Load Battery RAM (if present):
    this.loadBatteryRam();

    // Reset IRQ:
    //nes.getCpu().doResetInterrupt();
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }

  loadPRGROM() {
    if (this.nes.rom.romCount > 1) {
      // Load the two first banks into memory.
      this.loadRomBank(0, 0x8000);
      this.loadRomBank(1, 0xc000);
    } else {
      // Load the one bank into both memory locations:
      this.loadRomBank(0, 0x8000);
      this.loadRomBank(0, 0xc000);
    }
  }

  loadCHRROM() {
    // console.log("Loading CHR ROM..");
    if (this.nes.rom.vromCount > 0) {
      if (this.nes.rom.vromCount === 1) {
        this.loadVromBank(0, 0x0000);
        this.loadVromBank(0, 0x1000);
      } else {
        this.loadVromBank(0, 0x0000);
        this.loadVromBank(1, 0x1000);
      }
    } else {
      //System.out.println("There aren't any CHR-ROM banks..");
    }
  }

  loadBatteryRam() {
    if (this.nes.rom.batteryRam) {
      let ram = this.nes.rom.batteryRam;
      if (ram !== null && ram.length === 0x2000) {
        // Load Battery RAM into memory:
        copyArrayElements(ram, 0, this.nes.cpu.mem, 0x6000, 0x2000);
      }
    }
  }

  loadRomBank(bank, address) {
    // Loads a ROM bank into the specified address.
    bank %= this.nes.rom.romCount;
    //let data = this.nes.rom.rom[bank];
    //cpuMem.write(address,data,data.length);
    copyArrayElements(
      this.nes.rom.rom[bank],
      0,
      this.nes.cpu.mem,
      address,
      16384,
    );
  }

  loadVromBank(bank, address) {
    if (this.nes.rom.vromCount === 0) {
      return;
    }
    this.nes.ppu.triggerRendering();

    copyArrayElements(
      this.nes.rom.vrom[bank % this.nes.rom.vromCount],
      0,
      this.nes.ppu.vramMem,
      address,
      4096,
    );

    let vromTile = this.nes.rom.vromTile[bank % this.nes.rom.vromCount];
    copyArrayElements(vromTile, 0, this.nes.ppu.ptTile, address >> 4, 256);
  }

  load32kRomBank(bank, address) {
    this.loadRomBank((bank * 2) % this.nes.rom.romCount, address);
    this.loadRomBank((bank * 2 + 1) % this.nes.rom.romCount, address + 16384);
  }

  load8kVromBank(bank4kStart, address) {
    if (this.nes.rom.vromCount === 0) {
      return;
    }
    this.nes.ppu.triggerRendering();

    this.loadVromBank(bank4kStart % this.nes.rom.vromCount, address);
    this.loadVromBank(
      (bank4kStart + 1) % this.nes.rom.vromCount,
      address + 4096,
    );
  }

  load1kVromBank(bank1k, address) {
    if (this.nes.rom.vromCount === 0) {
      return;
    }
    this.nes.ppu.triggerRendering();

    let bank4k = Math.floor(bank1k / 4) % this.nes.rom.vromCount;
    let bankoffset = (bank1k % 4) * 1024;
    copyArrayElements(
      this.nes.rom.vrom[bank4k],
      bankoffset,
      this.nes.ppu.vramMem,
      address,
      1024,
    );

    // Update tiles:
    let vromTile = this.nes.rom.vromTile[bank4k];
    let baseIndex = address >> 4;
    for (let i = 0; i < 64; i++) {
      this.nes.ppu.ptTile[baseIndex + i] = vromTile[((bank1k % 4) << 6) + i];
    }
  }

  load2kVromBank(bank2k, address) {
    if (this.nes.rom.vromCount === 0) {
      return;
    }
    this.nes.ppu.triggerRendering();

    let bank4k = Math.floor(bank2k / 2) % this.nes.rom.vromCount;
    let bankoffset = (bank2k % 2) * 2048;
    copyArrayElements(
      this.nes.rom.vrom[bank4k],
      bankoffset,
      this.nes.ppu.vramMem,
      address,
      2048,
    );

    // Update tiles:
    let vromTile = this.nes.rom.vromTile[bank4k];
    let baseIndex = address >> 4;
    for (let i = 0; i < 128; i++) {
      this.nes.ppu.ptTile[baseIndex + i] = vromTile[((bank2k % 2) << 7) + i];
    }
  }

  load8kRomBank(bank8k, address) {
    let bank16k = Math.floor(bank8k / 2) % this.nes.rom.romCount;
    let offset = (bank8k % 2) * 8192;

    //this.nes.cpu.mem.write(address,this.nes.rom.rom[bank16k],offset,8192);
    copyArrayElements(
      this.nes.rom.rom[bank16k],
      offset,
      this.nes.cpu.mem,
      address,
      8192,
    );
  }

  // Returns true if the PPU can write to the given pattern table address.
  // Most mappers only allow writes when there's no CHR ROM (pure CHR RAM).
  // Mappers with mixed CHR ROM/RAM (e.g. TQROM) override this.
  // eslint-disable-next-line no-unused-vars
  canWriteChr(address) {
    return this.nes.rom.vromCount === 0;
  }

  clockIrqCounter() {
    // Does nothing. This is used by the MMC3 mapper.
  }

  // eslint-disable-next-line no-unused-vars
  latchAccess(address) {
    // Does nothing. This is used by MMC2.
  }

  // Called by the PPU before rendering background tiles for a scanline.
  // Override in mappers that need per-phase CHR bank switching (e.g. MMC5,
  // which uses separate CHR bank sets for sprites vs backgrounds).
  onBgRender() {}

  // Called by the PPU before rendering sprites.
  // Override in mappers that need per-phase CHR bank switching.
  onSpriteRender() {}

  // Called per-tile during BG rendering when bgTileOverride is true.
  // Returns {tile, attrib} to override the tile and attribute for a
  // background tile, or null to use the default lookup.
  // Used by MMC5 ExRAM mode 1 for per-tile CHR bank selection.
  getBgTileData(/* baseTile, tileIndex, ht, vt */) {
    return null;
  }

  // Look up a sprite pattern tile by ptTile index (0-511).
  // Default: return from the PPU's current ptTile cache.
  // MMC5 overrides this to look up from Set A's VROM banks directly,
  // since ptTile may have BG data (Set B) loaded during BG rendering.
  // This avoids calling load*VromBank (which triggers triggerRendering).
  getSpritePatternTile(index) {
    return this.nes.ppu.ptTile[index];
  }

  toJSON() {
    return {
      joy1StrobeState: this.joy1StrobeState,
      joy2StrobeState: this.joy2StrobeState,
      joypadLastWrite: this.joypadLastWrite,
      joypadOutputBit0: this.joypadOutputBit0,
      joypadLastWriteCycle: this.joypadLastWriteCycle,
    };
  }

  fromJSON(s) {
    this.joy1StrobeState = s.joy1StrobeState;
    this.joy2StrobeState = s.joy2StrobeState;
    this.joypadLastWrite = s.joypadLastWrite;
    this.joypadOutputBit0 = s.joypadOutputBit0 || 0;
    this.joypadLastWriteCycle = s.joypadLastWriteCycle ?? -2;
  }
}

/* harmony default export */ const mapper0 = (Mapper0);

;// ./src/mappers/mapper1.js


// MMC1 / SxROM (SKROM, SLROM, SNROM, etc.)
// Used by games like The Legend of Zelda, Metroid, Mega Man 2, Final Fantasy.
// Writes use a 5-bit serial shift register (5 consecutive writes to load a value).
// Provides switchable 16 KB PRG-ROM banks, 4 KB or 8 KB CHR banks,
// and software-controlled nametable mirroring.
// See https://www.nesdev.org/wiki/MMC1
class Mapper1 extends mapper0 {
  static mapperName = "MMC1";

  constructor(nes) {
    super(nes);

    // 5-bit buffer:
    this.regBuffer = 0;
    this.regBufferCounter = 0;

    // Register 0:
    this.mirroring = 0;
    this.oneScreenMirroring = 0;
    this.prgSwitchingArea = 1;
    this.prgSwitchingSize = 1;
    this.vromSwitchingSize = 0;

    // Register 1:
    this.romSelectionReg0 = 0;

    // Register 2:
    this.romSelectionReg1 = 0;

    // Register 3:
    this.romBankSelect = 0;
  }

  write(address, value) {
    // Writes to addresses other than MMC registers are handled by NoMapper.
    if (address < 0x8000) {
      super.write(address, value);
      return;
    }

    // See what should be done with the written value:
    if ((value & 128) !== 0) {
      // Reset buffering:
      this.regBufferCounter = 0;
      this.regBuffer = 0;

      // Reset register:
      if (this.getRegNumber(address) === 0) {
        this.prgSwitchingArea = 1;
        this.prgSwitchingSize = 1;
      }
    } else {
      // Continue buffering:
      //regBuffer = (regBuffer & (0xFF-(1<<regBufferCounter))) | ((value & (1<<regBufferCounter))<<regBufferCounter);
      this.regBuffer =
        (this.regBuffer & (0xff - (1 << this.regBufferCounter))) |
        ((value & 1) << this.regBufferCounter);
      this.regBufferCounter++;

      if (this.regBufferCounter === 5) {
        // Use the buffered value:
        this.setReg(this.getRegNumber(address), this.regBuffer);

        // Reset buffer:
        this.regBuffer = 0;
        this.regBufferCounter = 0;
      }
    }
  }

  setReg(reg, value) {
    let tmp;

    switch (reg) {
      case 0:
        // Mirroring:
        tmp = value & 3;
        if (tmp !== this.mirroring) {
          // Set mirroring:
          this.mirroring = tmp;
          if ((this.mirroring & 2) === 0) {
            // SingleScreen mirroring overrides the other setting:
            this.nes.ppu.setMirroring(this.nes.rom.SINGLESCREEN_MIRRORING);
          } else if ((this.mirroring & 1) !== 0) {
            // Not overridden by SingleScreen mirroring.
            this.nes.ppu.setMirroring(this.nes.rom.HORIZONTAL_MIRRORING);
          } else {
            this.nes.ppu.setMirroring(this.nes.rom.VERTICAL_MIRRORING);
          }
        }

        // PRG Switching Area;
        this.prgSwitchingArea = (value >> 2) & 1;

        // PRG Switching Size:
        this.prgSwitchingSize = (value >> 3) & 1;

        // VROM Switching Size:
        this.vromSwitchingSize = (value >> 4) & 1;

        break;

      case 1:
        // ROM selection:
        this.romSelectionReg0 = (value >> 4) & 1;

        // Check whether the cart has VROM:
        if (this.nes.rom.vromCount > 0) {
          // Select VROM bank at 0x0000:
          if (this.vromSwitchingSize === 0) {
            // Swap 8kB VROM:
            if (this.romSelectionReg0 === 0) {
              this.load8kVromBank(value & 0xf, 0x0000);
            } else {
              this.load8kVromBank(
                Math.floor(this.nes.rom.vromCount / 2) + (value & 0xf),
                0x0000,
              );
            }
          } else {
            // Swap 4kB VROM:
            if (this.romSelectionReg0 === 0) {
              this.loadVromBank(value & 0xf, 0x0000);
            } else {
              this.loadVromBank(
                Math.floor(this.nes.rom.vromCount / 2) + (value & 0xf),
                0x0000,
              );
            }
          }
        }

        break;

      case 2:
        // ROM selection:
        this.romSelectionReg1 = (value >> 4) & 1;

        // Check whether the cart has VROM:
        if (this.nes.rom.vromCount > 0) {
          // Select VROM bank at 0x1000:
          if (this.vromSwitchingSize === 1) {
            // Swap 4kB of VROM:
            if (this.romSelectionReg1 === 0) {
              this.loadVromBank(value & 0xf, 0x1000);
            } else {
              this.loadVromBank(
                Math.floor(this.nes.rom.vromCount / 2) + (value & 0xf),
                0x1000,
              );
            }
          }
        }
        break;

      default: {
        // Select ROM bank:
        // -------------------------
        let bank;
        let baseBank = 0;

        if (this.nes.rom.romCount >= 32) {
          // 1024 kB cart
          if (this.vromSwitchingSize === 0) {
            if (this.romSelectionReg0 === 1) {
              baseBank = 16;
            }
          } else {
            baseBank =
              (this.romSelectionReg0 | (this.romSelectionReg1 << 1)) << 3;
          }
        } else if (this.nes.rom.romCount >= 16) {
          // 512 kB cart
          if (this.romSelectionReg0 === 1) {
            baseBank = 8;
          }
        }

        if (this.prgSwitchingSize === 0) {
          // 32kB
          bank = baseBank + (value & 0xf);
          this.load32kRomBank(bank, 0x8000);
        } else {
          // 16kB
          bank = baseBank * 2 + (value & 0xf);
          if (this.prgSwitchingArea === 0) {
            this.loadRomBank(bank, 0xc000);
          } else {
            this.loadRomBank(bank, 0x8000);
          }
        }
      }
    }
  }

  // Returns the register number from the address written to:
  getRegNumber(address) {
    if (address >= 0x8000 && address <= 0x9fff) {
      return 0;
    } else if (address >= 0xa000 && address <= 0xbfff) {
      return 1;
    } else if (address >= 0xc000 && address <= 0xdfff) {
      return 2;
    } else {
      return 3;
    }
  }

  loadROM() {
    if (!this.nes.rom.valid) {
      throw new Error("MMC1: Invalid ROM! Unable to load.");
    }

    // Load PRG-ROM:
    this.loadRomBank(0, 0x8000); //   First ROM bank..
    this.loadRomBank(this.nes.rom.romCount - 1, 0xc000); // ..and last ROM bank.

    // Load CHR-ROM:
    this.loadCHRROM();

    // Load Battery RAM (if present):
    this.loadBatteryRam();

    // Do Reset-Interrupt:
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }

  // eslint-disable-next-line no-unused-vars
  switchLowHighPrgRom(oldSetting) {
    // not yet.
  }

  switch16to32() {
    // not yet.
  }

  switch32to16() {
    // not yet.
  }

  toJSON() {
    let s = super.toJSON();
    s.mirroring = this.mirroring;
    s.oneScreenMirroring = this.oneScreenMirroring;
    s.prgSwitchingArea = this.prgSwitchingArea;
    s.prgSwitchingSize = this.prgSwitchingSize;
    s.vromSwitchingSize = this.vromSwitchingSize;
    s.romSelectionReg0 = this.romSelectionReg0;
    s.romSelectionReg1 = this.romSelectionReg1;
    s.romBankSelect = this.romBankSelect;
    s.regBuffer = this.regBuffer;
    s.regBufferCounter = this.regBufferCounter;
    return s;
  }

  fromJSON(s) {
    super.fromJSON(s);
    this.mirroring = s.mirroring;
    this.oneScreenMirroring = s.oneScreenMirroring;
    this.prgSwitchingArea = s.prgSwitchingArea;
    this.prgSwitchingSize = s.prgSwitchingSize;
    this.vromSwitchingSize = s.vromSwitchingSize;
    this.romSelectionReg0 = s.romSelectionReg0;
    this.romSelectionReg1 = s.romSelectionReg1;
    this.romBankSelect = s.romBankSelect;
    this.regBuffer = s.regBuffer;
    this.regBufferCounter = s.regBufferCounter;
  }
}

/* harmony default export */ const mapper1 = (Mapper1);

;// ./src/mappers/mapper2.js


// UxROM (NES-UNROM, NES-UOROM)
// Used by games like Mega Man, Castlevania, Contra, Duck Tales, Metal Gear.
// 16 KB switchable PRG-ROM bank at $8000, last 16 KB bank fixed at $C000.
// Uses CHR-RAM (no CHR-ROM bank switching).
// See https://www.nesdev.org/wiki/UxROM
class Mapper2 extends mapper0 {
  static mapperName = "UxROM";

  constructor(nes) {
    super(nes);
  }

  write(address, value) {
    // Writes to addresses other than MMC registers are handled by NoMapper.
    if (address < 0x8000) {
      super.write(address, value);
      return;
    } else {
      // This is a ROM bank select command.
      // Swap in the given ROM bank at 0x8000:
      this.loadRomBank(value, 0x8000);
    }
  }

  loadROM() {
    if (!this.nes.rom.valid) {
      throw new Error("UNROM: Invalid ROM! Unable to load.");
    }

    // Load PRG-ROM:
    this.loadRomBank(0, 0x8000);
    this.loadRomBank(this.nes.rom.romCount - 1, 0xc000);

    // Load CHR-ROM:
    this.loadCHRROM();

    // Do Reset-Interrupt:
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }
}

/* harmony default export */ const mapper2 = (Mapper2);

;// ./src/mappers/mapper3.js


// CNROM
// Used by games like Solomon's Key, Arkanoid, Arkista's Ring, Bump 'n' Jump.
// Fixed PRG-ROM (up to 32 KB), with switchable 8 KB CHR-ROM banks.
// See https://www.nesdev.org/wiki/INES_Mapper_003
class Mapper3 extends mapper0 {
  static mapperName = "CNROM";

  constructor(nes) {
    super(nes);
  }

  write(address, value) {
    // Writes to addresses other than MMC registers are handled by NoMapper.
    if (address < 0x8000) {
      super.write(address, value);
      return;
    } else {
      // This is a ROM bank select command.
      // Swap in the given ROM bank at 0x8000:
      // This is a VROM bank select command.
      // Swap in the given VROM bank at 0x0000:
      this.load8kVromBank(value * 2, 0x0000);
    }
  }
}

/* harmony default export */ const mapper3 = (Mapper3);

;// ./src/mappers/mapper4.js


// MMC3 / TxROM (TSROM, TLSROM, TQROM, etc.)
// Used by games like Super Mario Bros. 2, Super Mario Bros. 3, Kirby's Adventure.
// Fine-grained bank switching: two 8 KB switchable PRG-ROM banks, two 2 KB + four
// 1 KB CHR banks. Provides a scanline-counting IRQ for split-screen effects and
// software-switchable H/V nametable mirroring.
// See https://www.nesdev.org/wiki/MMC3
class Mapper4 extends mapper0 {
  static mapperName = "MMC3";
  static CMD_SEL_2_1K_VROM_0000 = 0;
  static CMD_SEL_2_1K_VROM_0800 = 1;
  static CMD_SEL_1K_VROM_1000 = 2;
  static CMD_SEL_1K_VROM_1400 = 3;
  static CMD_SEL_1K_VROM_1800 = 4;
  static CMD_SEL_1K_VROM_1C00 = 5;
  static CMD_SEL_ROM_PAGE1 = 6;
  static CMD_SEL_ROM_PAGE2 = 7;

  constructor(nes) {
    super(nes);
    this.command = 0;
    this.prgAddressSelect = 0;
    this.chrAddressSelect = 0;
    this.pageNumber = 0;
    this.irqCounter = 0;
    this.irqLatchValue = 0;
    this.irqEnable = 0;
    this.prgAddressChanged = false;
  }

  write(address, value) {
    // Writes to addresses other than MMC registers are handled by NoMapper.
    if (address < 0x8000) {
      super.write(address, value);
      return;
    }

    switch (address & 0xe001) {
      case 0x8000: {
        // Command/Address Select register
        this.command = value & 7;
        const tmp = (value >> 6) & 1;
        if (tmp !== this.prgAddressSelect) {
          this.prgAddressChanged = true;
        }
        this.prgAddressSelect = tmp;
        this.chrAddressSelect = (value >> 7) & 1;
        break;
      }

      case 0x8001:
        // Page number for command
        this.executeCommand(this.command, value);
        break;

      case 0xa000:
        // Mirroring select
        if ((value & 1) !== 0) {
          this.nes.ppu.setMirroring(this.nes.rom.HORIZONTAL_MIRRORING);
        } else {
          this.nes.ppu.setMirroring(this.nes.rom.VERTICAL_MIRRORING);
        }
        break;

      case 0xa001:
        // SaveRAM Toggle
        // TODO
        //nes.getRom().setSaveState((value&1)!=0);
        break;

      case 0xc000:
        // IRQ Counter register
        this.irqCounter = value;
        //nes.ppu.mapperIrqCounter = 0;
        break;

      case 0xc001:
        // IRQ Latch register
        this.irqLatchValue = value;
        break;

      case 0xe000:
        // IRQ Control Reg 0 (disable)
        //irqCounter = irqLatchValue;
        this.irqEnable = 0;
        break;

      case 0xe001:
        // IRQ Control Reg 1 (enable)
        this.irqEnable = 1;
        break;

      // No default needed: the 0xE001 mask maps every address >= $8000
      // to one of the eight cases above.
    }
  }

  executeCommand(cmd, arg) {
    switch (cmd) {
      case Mapper4.CMD_SEL_2_1K_VROM_0000:
        // Select 2 1KB VROM pages at 0x0000:
        if (this.chrAddressSelect === 0) {
          this.load1kVromBank(arg, 0x0000);
          this.load1kVromBank(arg + 1, 0x0400);
        } else {
          this.load1kVromBank(arg, 0x1000);
          this.load1kVromBank(arg + 1, 0x1400);
        }
        break;

      case Mapper4.CMD_SEL_2_1K_VROM_0800:
        // Select 2 1KB VROM pages at 0x0800:
        if (this.chrAddressSelect === 0) {
          this.load1kVromBank(arg, 0x0800);
          this.load1kVromBank(arg + 1, 0x0c00);
        } else {
          this.load1kVromBank(arg, 0x1800);
          this.load1kVromBank(arg + 1, 0x1c00);
        }
        break;

      case Mapper4.CMD_SEL_1K_VROM_1000:
        // Select 1K VROM Page at 0x1000:
        if (this.chrAddressSelect === 0) {
          this.load1kVromBank(arg, 0x1000);
        } else {
          this.load1kVromBank(arg, 0x0000);
        }
        break;

      case Mapper4.CMD_SEL_1K_VROM_1400:
        // Select 1K VROM Page at 0x1400:
        if (this.chrAddressSelect === 0) {
          this.load1kVromBank(arg, 0x1400);
        } else {
          this.load1kVromBank(arg, 0x0400);
        }
        break;

      case Mapper4.CMD_SEL_1K_VROM_1800:
        // Select 1K VROM Page at 0x1800:
        if (this.chrAddressSelect === 0) {
          this.load1kVromBank(arg, 0x1800);
        } else {
          this.load1kVromBank(arg, 0x0800);
        }
        break;

      case Mapper4.CMD_SEL_1K_VROM_1C00:
        // Select 1K VROM Page at 0x1C00:
        if (this.chrAddressSelect === 0) {
          this.load1kVromBank(arg, 0x1c00);
        } else {
          this.load1kVromBank(arg, 0x0c00);
        }
        break;

      case Mapper4.CMD_SEL_ROM_PAGE1:
        if (this.prgAddressChanged) {
          // Load the two hardwired banks:
          if (this.prgAddressSelect === 0) {
            this.load8kRomBank((this.nes.rom.romCount - 1) * 2, 0xc000);
          } else {
            this.load8kRomBank((this.nes.rom.romCount - 1) * 2, 0x8000);
          }
          this.prgAddressChanged = false;
        }

        // Select first switchable ROM page:
        if (this.prgAddressSelect === 0) {
          this.load8kRomBank(arg, 0x8000);
        } else {
          this.load8kRomBank(arg, 0xc000);
        }
        break;

      case Mapper4.CMD_SEL_ROM_PAGE2:
        // Select second switchable ROM page:
        this.load8kRomBank(arg, 0xa000);

        // hardwire appropriate bank:
        if (this.prgAddressChanged) {
          // Load the two hardwired banks:
          if (this.prgAddressSelect === 0) {
            this.load8kRomBank((this.nes.rom.romCount - 1) * 2, 0xc000);
          } else {
            this.load8kRomBank((this.nes.rom.romCount - 1) * 2, 0x8000);
          }
          this.prgAddressChanged = false;
        }
    }
  }

  loadROM() {
    if (!this.nes.rom.valid) {
      throw new Error("MMC3: Invalid ROM! Unable to load.");
    }

    // Load hardwired PRG banks (0xC000 and 0xE000):
    this.load8kRomBank((this.nes.rom.romCount - 1) * 2, 0xc000);
    this.load8kRomBank((this.nes.rom.romCount - 1) * 2 + 1, 0xe000);

    // Load swappable PRG banks (0x8000 and 0xA000):
    this.load8kRomBank(0, 0x8000);
    this.load8kRomBank(1, 0xa000);

    // Load CHR-ROM:
    this.loadCHRROM();

    // Load Battery RAM (if present):
    this.loadBatteryRam();

    // Do Reset-Interrupt:
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }

  clockIrqCounter() {
    if (this.irqEnable === 1) {
      this.irqCounter--;
      if (this.irqCounter < 0) {
        // Trigger IRQ:
        //nes.getCpu().doIrq();
        this.nes.cpu.requestIrq(this.nes.cpu.IRQ_NORMAL);
        this.irqCounter = this.irqLatchValue;
      }
    }
  }

  toJSON() {
    let s = super.toJSON();
    s.command = this.command;
    s.prgAddressSelect = this.prgAddressSelect;
    s.chrAddressSelect = this.chrAddressSelect;
    s.pageNumber = this.pageNumber;
    s.irqCounter = this.irqCounter;
    s.irqLatchValue = this.irqLatchValue;
    s.irqEnable = this.irqEnable;
    s.prgAddressChanged = this.prgAddressChanged;
    return s;
  }

  fromJSON(s) {
    super.fromJSON(s);
    this.command = s.command;
    this.prgAddressSelect = s.prgAddressSelect;
    this.chrAddressSelect = s.chrAddressSelect;
    this.pageNumber = s.pageNumber;
    this.irqCounter = s.irqCounter;
    this.irqLatchValue = s.irqLatchValue;
    this.irqEnable = s.irqEnable;
    this.prgAddressChanged = s.prgAddressChanged;
  }
}

/* harmony default export */ const mapper4 = (Mapper4);

;// ./src/mappers/mapper5.js



// MMC5 / ExROM (EKROM, ELROM, ETROM, EWROM)
// Used by games like Castlevania III, Just Breed, Uncharted Waters, Metal Slader Glory.
// The most complex Nintendo mapper. Flexible PRG/CHR banking (up to 1 MB each),
// expansion audio (2 pulse + PCM), 8x8 hardware multiplier, 1 KB ExRAM for extended
// nametable attributes, vertical split screen, and scanline-counting IRQ.
// See https://www.nesdev.org/wiki/MMC5
class Mapper5 extends mapper0 {
  static mapperName = "MMC5";

  constructor(nes) {
    super(nes);

    // PRG banking
    // $5100: PRG mode (0=32K, 1=16K+16K, 2=16K+8K+8K, 3=8K+8K+8K+8K)
    this.prgMode = 3; // Power-on default: mode 3 (8K banks)
    // $5113-$5117: PRG bank registers. Raw values written by the game.
    // $5113 always maps RAM to $6000-$7FFF.
    // $5114-$5116 bit 7: 0=RAM, 1=ROM. $5117 always ROM.
    this.prgBankReg = new Uint8Array(5); // indices 0-4 for $5113-$5117
    this.prgBankReg[4] = 0xff; // $5117 defaults to last page (0xFF)

    // PRG RAM: up to 64 KB (two 32 KB chips), banked into $6000-$7FFF.
    // Also mappable into $8000-$DFFF via bank registers with bit 7 clear.
    this.prgRam = new Uint8Array(0x10000); // 64 KB PRG RAM

    // PRG RAM write protection: $5102 and $5103
    // Writes only enabled when $5102=%10 and $5103=%01
    // Both reset to %11 ($03) per nesdev wiki, which keeps RAM write-protected.
    this.prgRamProtectA = 0x03; // $5102
    this.prgRamProtectB = 0x03; // $5103

    // CHR banking
    // $5101: CHR mode (0=8K, 1=4K, 2=2K, 3=1K)
    this.chrMode = 3; // Power-on default: mode 3 (1K banks)
    // $5120-$5127: CHR bank set A (sprite banks)
    this.chrBankA = new Uint16Array(8);
    // $5128-$512B: CHR bank set B (background banks)
    this.chrBankB = new Uint16Array(4);
    // $5130: Upper CHR bank bits (bits 8-9 appended to bank registers)
    this.chrUpperBits = 0;
    // Tracks which CHR set was last written (0=A, 1=B) for $2007 access
    this.lastChrWrite = 0;

    // Nametable mapping: $5105
    // Each 2-bit field: 0=CIRAM A, 1=CIRAM B, 2=ExRAM, 3=Fill
    this.ntMapping = new Uint8Array(4);

    // ExRAM: 1 KB internal to MMC5, used for nametable/extended attributes/RAM
    // $5104: ExRAM mode (0=nametable, 1=ext attributes, 2=RAM, 3=read-only)
    this.exramMode = 0;
    this.exram = new Uint8Array(0x400); // 1 KB

    // Fill mode: $5106/$5107
    this.fillTile = 0;
    this.fillAttr = 0;

    // Scanline IRQ: $5203/$5204
    // The MMC5 counts scanlines by monitoring PPU nametable fetches.
    // See https://www.nesdev.org/wiki/MMC5#Scanline_detection_and_scanline_IRQ
    this.irqTarget = 0; // $5203: target scanline
    this.irqEnabled = false; // $5204 bit 7 write: IRQ enable
    this.irqPending = false; // $5204 bit 7 read: IRQ pending flag
    this.inFrame = false; // $5204 bit 6 read: in-frame flag
    this.irqCounter = 0; // Internal scanline counter

    // Hardware multiplier: $5205/$5206
    // Write two 8-bit unsigned values, read 16-bit product immediately.
    // Wiki doesn't specify power-on default; FCEUX uses 0. Using 0 as safe default.
    this.multA = 0;
    this.multB = 0;

    // Split screen: $5200-$5202
    // Not commonly used. Basic support for register storage.
    this.splitEnabled = false; // $5200 bit 7
    this.splitRight = false; // $5200 bit 6 (0=left, 1=right)
    this.splitTile = 0; // $5200 bits 0-4: tile threshold
    this.splitScroll = 0; // $5201: vertical scroll for split
    this.splitPage = 0; // $5202: 4K CHR page for split

    // Expansion audio: two pulse channels + PCM
    // The MMC5 pulse channels are similar to APU square channels but lack
    // sweep units and don't silence at low frequencies.
    // See https://www.nesdev.org/wiki/MMC5_audio
    this.pulse1 = this._initPulse();
    this.pulse2 = this._initPulse();
    this.pcmValue = 0; // $5011: raw 8-bit PCM output
    this.pcmReadMode = false; // $5010 bit 0
    this.pcmIrqEnabled = false; // $5010 bit 7
    this.audioEnabled = 0; // $5015: pulse channel enable bits

    // Tracks which CHR bank set is currently loaded into the PPU's pattern
    // table cache. Used by onBgRender/onSpriteRender to avoid redundant
    // bank switches. -1 = unknown/dirty, 0 = set A (sprites), 1 = set B (BG).
    this._chrBankTarget = -1;
  }

  // Initialize a pulse channel state object.
  // MMC5 pulse channels are like APU square channels minus the sweep unit.
  _initPulse() {
    return {
      enabled: false,
      dutyCycle: 0, // 2-bit duty
      lengthHalt: false, // envelope loop / length counter halt
      constantVolume: false,
      volume: 0, // 4-bit volume/envelope
      timer: 0, // 11-bit timer period
      timerCounter: 0,
      lengthCounter: 0,
      envelopeCounter: 0,
      envelopeDecay: 15,
      envelopeStart: false,
      sequencePos: 0,
    };
  }

  // --- CPU Read Handler ---
  // Override load() to handle MMC5 register reads and banked PRG access.
  load(address) {
    address &= 0xffff;

    if (address < 0x5000) {
      // Standard read (RAM, PPU regs, APU regs, controllers)
      return super.load(address);
    }

    // $5000-$5017: Expansion audio read-back
    if (address === 0x5015) {
      // Status register: bits 0-1 indicate pulse channel length counter > 0
      let val = 0;
      if (this.pulse1.lengthCounter > 0) val |= 0x01;
      if (this.pulse2.lengthCounter > 0) val |= 0x02;
      return val;
    }

    if (address === 0x5010) {
      // PCM IRQ status (bit 7). Reading clears the flag.
      // PCM IRQ is rarely used; return 0 for now.
      return 0;
    }

    // $5100-$5104: Write-only control registers — return open bus
    if (address >= 0x5100 && address <= 0x5104) {
      return this.nes.cpu.dataBus;
    }

    // $5105: Nametable mapping (write-only, open bus on read)
    if (address === 0x5105) {
      return this.nes.cpu.dataBus;
    }

    // $5204: Scanline IRQ status
    if (address === 0x5204) {
      // The in-frame flag reflects whether the PPU is actively rendering.
      // Since the PPU only calls clockIrqCounter during rendering, we check
      // the current PPU state to determine in-frame for reads outside rendering.
      let ppu = this.nes.ppu;
      let rendering =
        ppu.scanline >= 20 &&
        ppu.scanline <= 260 &&
        (ppu.f_bgVisibility === 1 || ppu.f_spVisibility === 1);
      if (!rendering) {
        this.inFrame = false;
      }

      let val = 0;
      if (this.irqPending) val |= 0x80;
      if (this.inFrame) val |= 0x40;
      // Reading $5204 acknowledges (clears) the IRQ pending flag
      this.irqPending = false;
      return val;
    }

    // $5205: Multiplier result low byte
    if (address === 0x5205) {
      return (this.multA * this.multB) & 0xff;
    }

    // $5206: Multiplier result high byte
    if (address === 0x5206) {
      return ((this.multA * this.multB) >> 8) & 0xff;
    }

    // $5C00-$5FFF: ExRAM
    if (address >= 0x5c00 && address <= 0x5fff) {
      // Readable in modes 2 and 3 only; otherwise open bus
      if (this.exramMode >= 2) {
        return this.exram[address - 0x5c00];
      }
      return this.nes.cpu.dataBus;
    }

    // $5000-$5BFF other: expansion area, return open bus
    if (address < 0x6000) {
      return this.nes.cpu.dataBus;
    }

    // $6000-$7FFF: PRG RAM (banked via $5113)
    if (address < 0x8000) {
      let bank = this.prgBankReg[0] & 0x07; // 3-bit page within 64K RAM
      let offset = bank * 0x2000 + (address - 0x6000);
      return this.prgRam[offset & 0xffff];
    }

    // $8000-$FFFF: PRG ROM/RAM (banked via $5114-$5117 and prgMode)
    return this._readPrg(address);
  }

  // Read from banked PRG space ($8000-$FFFF).
  // In modes where a region can map to RAM (bit 7 of bank reg = 0),
  // reads come from prgRam. Otherwise, reads come from ROM.
  _readPrg(address) {
    let slot, reg, isRam, bank, base;

    switch (this.prgMode) {
      case 0:
        // Mode 0: One 32K bank at $8000-$FFFF, controlled by $5117
        // Ignore low 2 bits for 32K alignment
        reg = this.prgBankReg[4];
        bank = (reg & 0x7c) >> 2; // 32K page = bits 6-2
        return this._readPrgRom32k(bank, address - 0x8000);

      case 1:
        // Mode 1: Two 16K banks
        // $8000-$BFFF: $5115 (can be RAM if bit 7=0)
        // $C000-$FFFF: $5117 (always ROM)
        if (address < 0xc000) {
          reg = this.prgBankReg[2]; // $5115
          isRam = (reg & 0x80) === 0;
          if (isRam) {
            bank = (reg & 0x06) >> 1; // 16K RAM page
            return this.prgRam[bank * 0x4000 + (address - 0x8000)];
          }
          bank = (reg & 0x7e) >> 1; // 16K ROM page (ignore bit 0)
          return this._readPrgRom16k(bank, address - 0x8000);
        } else {
          reg = this.prgBankReg[4]; // $5117
          bank = (reg & 0x7e) >> 1; // 16K ROM page
          return this._readPrgRom16k(bank, address - 0xc000);
        }

      case 2:
        // Mode 2: 16K + 8K + 8K
        // $8000-$BFFF: $5115 (RAM or ROM)
        // $C000-$DFFF: $5116 (RAM or ROM)
        // $E000-$FFFF: $5117 (always ROM)
        if (address < 0xc000) {
          reg = this.prgBankReg[2]; // $5115
          isRam = (reg & 0x80) === 0;
          if (isRam) {
            bank = (reg & 0x06) >> 1;
            return this.prgRam[bank * 0x4000 + (address - 0x8000)];
          }
          bank = (reg & 0x7e) >> 1;
          return this._readPrgRom16k(bank, address - 0x8000);
        } else if (address < 0xe000) {
          reg = this.prgBankReg[3]; // $5116
          isRam = (reg & 0x80) === 0;
          if (isRam) {
            bank = reg & 0x07;
            return this.prgRam[bank * 0x2000 + (address - 0xc000)];
          }
          bank = reg & 0x7f;
          return this._readPrgRom8k(bank, address - 0xc000);
        } else {
          reg = this.prgBankReg[4]; // $5117
          bank = reg & 0x7f;
          return this._readPrgRom8k(bank, address - 0xe000);
        }

      case 3:
      default:
        // Mode 3: Four 8K banks
        // $8000-$9FFF: $5114 (RAM or ROM)
        // $A000-$BFFF: $5115 (RAM or ROM)
        // $C000-$DFFF: $5116 (RAM or ROM)
        // $E000-$FFFF: $5117 (always ROM)
        if (address < 0xa000) {
          slot = 1; // $5114
        } else if (address < 0xc000) {
          slot = 2; // $5115
        } else if (address < 0xe000) {
          slot = 3; // $5116
        } else {
          slot = 4; // $5117
        }
        reg = this.prgBankReg[slot];
        base =
          slot === 1
            ? 0x8000
            : slot === 2
              ? 0xa000
              : slot === 3
                ? 0xc000
                : 0xe000;
        // $5117 is always ROM; $5114-$5116 use bit 7 for RAM/ROM select
        if (slot < 4 && (reg & 0x80) === 0) {
          bank = reg & 0x07;
          return this.prgRam[bank * 0x2000 + (address - base)];
        }
        bank = reg & 0x7f;
        return this._readPrgRom8k(bank, address - base);
    }
  }

  // Read a byte from PRG ROM given a 32K bank number and offset within it.
  _readPrgRom32k(bank32k, offset) {
    // ROM is stored as 16K banks in rom.rom[]
    let bank16k =
      (bank32k * 2 + Math.floor(offset / 0x4000)) % this.nes.rom.romCount;
    let innerOffset = offset % 0x4000;
    return this.nes.rom.rom[bank16k][innerOffset];
  }

  // Read a byte from PRG ROM given a 16K bank number and offset within it.
  _readPrgRom16k(bank16k, offset) {
    bank16k %= this.nes.rom.romCount;
    return this.nes.rom.rom[bank16k][offset];
  }

  // Read a byte from PRG ROM given an 8K bank number and offset within it.
  _readPrgRom8k(bank8k, offset) {
    let bank16k = Math.floor(bank8k / 2) % this.nes.rom.romCount;
    let innerOffset = (bank8k % 2) * 0x2000 + offset;
    if (bank16k < this.nes.rom.romCount) {
      return this.nes.rom.rom[bank16k][innerOffset];
    }
    return 0;
  }

  // --- CPU Write Handler ---
  write(address, value) {
    // Standard NES write handling for addresses below $5000
    if (address < 0x5000) {
      super.write(address, value);

      // MMC5 monitors writes to $2000 to track 8x8 vs 8x16 sprite mode.
      // This affects which CHR bank set is used for rendering.
      // The PPU already parses $2000, so we just note it here.
      return;
    }

    // $5000-$5015: Expansion audio registers
    if (address >= 0x5000 && address <= 0x5003) {
      this._writePulse(this.pulse1, address - 0x5000, value);
      return;
    }
    if (address >= 0x5004 && address <= 0x5007) {
      this._writePulse(this.pulse2, address - 0x5004, value);
      return;
    }
    if (address === 0x5010) {
      this.pcmReadMode = (value & 0x01) !== 0;
      this.pcmIrqEnabled = (value & 0x80) !== 0;
      return;
    }
    if (address === 0x5011) {
      // Raw PCM write. Writing $00 has no effect on the output.
      if (!this.pcmReadMode && value !== 0) {
        this.pcmValue = value;
      }
      return;
    }
    if (address === 0x5015) {
      // Expansion audio status: bits 0-1 enable pulse channels
      this.audioEnabled = value & 0x03;
      this.pulse1.enabled = (value & 0x01) !== 0;
      this.pulse2.enabled = (value & 0x02) !== 0;
      if (!this.pulse1.enabled) this.pulse1.lengthCounter = 0;
      if (!this.pulse2.enabled) this.pulse2.lengthCounter = 0;
      return;
    }

    // $5100: PRG banking mode
    if (address === 0x5100) {
      this.prgMode = value & 0x03;
      this._syncPrg();
      return;
    }

    // $5101: CHR banking mode
    if (address === 0x5101) {
      this.chrMode = value & 0x03;
      this._syncChr();
      return;
    }

    // $5102/$5103: PRG RAM write protection
    if (address === 0x5102) {
      this.prgRamProtectA = value & 0x03;
      return;
    }
    if (address === 0x5103) {
      this.prgRamProtectB = value & 0x03;
      return;
    }

    // $5104: ExRAM mode
    if (address === 0x5104) {
      this.exramMode = value & 0x03;
      // ExRAM mode 1 enables per-tile BG override: each ExRAM byte provides
      // a 4KB CHR bank + attribute for the corresponding background tile.
      this.bgTileOverride = this.exramMode === 1;
      this._syncNametables();
      return;
    }

    // $5105: Nametable mapping
    if (address === 0x5105) {
      let v = value;
      this.ntMapping[0] = v & 0x03;
      v >>= 2;
      this.ntMapping[1] = v & 0x03;
      v >>= 2;
      this.ntMapping[2] = v & 0x03;
      v >>= 2;
      this.ntMapping[3] = v & 0x03;
      this._syncNametables();
      return;
    }

    // $5106: Fill-mode tile
    if (address === 0x5106) {
      this.fillTile = value;
      this._syncNametables();
      return;
    }

    // $5107: Fill-mode attribute (bottom 2 bits)
    if (address === 0x5107) {
      this.fillAttr = value & 0x03;
      this._syncNametables();
      return;
    }

    // $5113: PRG RAM bank for $6000-$7FFF
    if (address === 0x5113) {
      this.prgBankReg[0] = value & 0x07;
      return;
    }

    // $5114-$5117: PRG bank registers
    if (address >= 0x5114 && address <= 0x5117) {
      let idx = address - 0x5113; // 1-4
      this.prgBankReg[idx] = value;
      this._syncPrg();
      return;
    }

    // $5120-$5127: CHR bank set A (sprites / "last written" set)
    if (address >= 0x5120 && address <= 0x5127) {
      let reg = address - 0x5120;
      this.chrBankA[reg] = (this.chrUpperBits << 8) | value;
      this.lastChrWrite = 0;
      this._syncChr();
      return;
    }

    // $5128-$512B: CHR bank set B (background)
    if (address >= 0x5128 && address <= 0x512b) {
      let reg = address - 0x5128;
      this.chrBankB[reg] = (this.chrUpperBits << 8) | value;
      this.lastChrWrite = 1;
      this._syncChr();
      return;
    }

    // $5130: Upper CHR bank bits
    if (address === 0x5130) {
      this.chrUpperBits = value & 0x03;
      return;
    }

    // $5200: Split screen control
    if (address === 0x5200) {
      this.splitEnabled = (value & 0x80) !== 0;
      this.splitRight = (value & 0x40) !== 0;
      this.splitTile = value & 0x1f;
      return;
    }

    // $5201: Split screen Y scroll
    if (address === 0x5201) {
      this.splitScroll = value;
      return;
    }

    // $5202: Split screen CHR page
    if (address === 0x5202) {
      this.splitPage = value & 0x3f;
      return;
    }

    // $5203: Scanline IRQ target
    if (address === 0x5203) {
      this.irqTarget = value;
      return;
    }

    // $5204: Scanline IRQ enable
    if (address === 0x5204) {
      this.irqEnabled = (value & 0x80) !== 0;
      // If both enabled and pending, fire IRQ immediately
      if (this.irqEnabled && this.irqPending) {
        this.nes.cpu.requestIrq(this.nes.cpu.IRQ_NORMAL);
      }
      return;
    }

    // $5205: Multiplier operand A
    if (address === 0x5205) {
      this.multA = value;
      return;
    }

    // $5206: Multiplier operand B
    if (address === 0x5206) {
      this.multB = value;
      return;
    }

    // $5C00-$5FFF: ExRAM writes
    if (address >= 0x5c00 && address <= 0x5fff) {
      let exAddr = address - 0x5c00;
      if (this.exramMode === 0 || this.exramMode === 1) {
        // Modes 0/1: writable only during rendering (in-frame).
        // If not in-frame, $00 is written instead.
        this.exram[exAddr] = this.inFrame ? value : 0x00;
        // If ExRAM is used as a nametable, sync it to VRAM
        this._syncExramToVram(exAddr);
      } else if (this.exramMode === 2) {
        // Mode 2: general-purpose RAM, always writable
        this.exram[exAddr] = value;
      }
      // Mode 3: read-only, writes have no effect
      return;
    }

    // $6000-$7FFF: PRG RAM writes (write-protected via $5102/$5103)
    if (address >= 0x6000 && address <= 0x7fff) {
      if (this.prgRamProtectA === 0x02 && this.prgRamProtectB === 0x01) {
        let bank = this.prgBankReg[0] & 0x07;
        let offset = bank * 0x2000 + (address - 0x6000);
        this.prgRam[offset & 0xffff] = value;
        // Also write to CPU mem for compatibility with save state / battery RAM
        this.nes.cpu.mem[address] = value;
        this.nes.opts.onBatteryRamWrite(address, value);
      }
      return;
    }

    // $8000-$FFFF: PRG ROM/RAM writes
    if (address >= 0x8000) {
      this._writePrg(address, value);
      return;
    }
  }

  // Handle writes to the PRG address space ($8000-$FFFF).
  // Some bank slots may be mapped to RAM if bit 7 of the bank register is 0.
  _writePrg(address, value) {
    let slot, reg, isRam, bank, base;

    switch (this.prgMode) {
      case 0:
        // Mode 0: Entire $8000-$FFFF is a single 32K ROM bank — not writable
        return;

      case 1:
        // $8000-$BFFF: $5115 (can be RAM)
        // $C000-$FFFF: $5117 (always ROM)
        if (address < 0xc000) {
          reg = this.prgBankReg[2];
          isRam = (reg & 0x80) === 0;
          if (isRam && this._isPrgRamWritable()) {
            bank = (reg & 0x06) >> 1;
            this.prgRam[bank * 0x4000 + (address - 0x8000)] = value;
          }
        }
        return;

      case 2:
        // $8000-$BFFF: $5115 (can be RAM)
        // $C000-$DFFF: $5116 (can be RAM)
        // $E000-$FFFF: $5117 (always ROM)
        if (address < 0xc000) {
          reg = this.prgBankReg[2];
          isRam = (reg & 0x80) === 0;
          if (isRam && this._isPrgRamWritable()) {
            bank = (reg & 0x06) >> 1;
            this.prgRam[bank * 0x4000 + (address - 0x8000)] = value;
          }
        } else if (address < 0xe000) {
          reg = this.prgBankReg[3];
          isRam = (reg & 0x80) === 0;
          if (isRam && this._isPrgRamWritable()) {
            bank = reg & 0x07;
            this.prgRam[bank * 0x2000 + (address - 0xc000)] = value;
          }
        }
        return;

      case 3:
      default:
        // $8000-$9FFF: $5114 (can be RAM)
        // $A000-$BFFF: $5115 (can be RAM)
        // $C000-$DFFF: $5116 (can be RAM)
        // $E000-$FFFF: $5117 (always ROM)
        if (address < 0xa000) {
          slot = 1;
          base = 0x8000;
        } else if (address < 0xc000) {
          slot = 2;
          base = 0xa000;
        } else if (address < 0xe000) {
          slot = 3;
          base = 0xc000;
        } else {
          return; // $5117 is always ROM
        }
        reg = this.prgBankReg[slot];
        isRam = (reg & 0x80) === 0;
        if (isRam && this._isPrgRamWritable()) {
          bank = reg & 0x07;
          this.prgRam[bank * 0x2000 + (address - base)] = value;
        }
        return;
    }
  }

  // Check if PRG RAM writes are enabled via the two protection registers.
  _isPrgRamWritable() {
    return this.prgRamProtectA === 0x02 && this.prgRamProtectB === 0x01;
  }

  // --- PRG Synchronization ---
  // Copy the selected PRG ROM banks into CPU address space so the CPU can
  // read them directly. This follows the same approach as other mappers.
  // Called when prgMode or bank registers change.
  _syncPrg() {
    switch (this.prgMode) {
      case 0: {
        // 32K bank at $8000-$FFFF from $5117
        let reg = this.prgBankReg[4];
        let bank = (reg & 0x7c) >> 2; // 32K page
        this.load32kRomBank(bank, 0x8000);
        break;
      }
      case 1: {
        // $8000-$BFFF from $5115, $C000-$FFFF from $5117
        let regLo = this.prgBankReg[2]; // $5115
        if (regLo & 0x80) {
          // ROM
          let bank16k = (regLo & 0x7e) >> 1;
          this.loadRomBank(bank16k % this.nes.rom.romCount, 0x8000);
        }
        // else: RAM — reads will be handled by load() override

        let regHi = this.prgBankReg[4]; // $5117
        let bank16kHi = (regHi & 0x7e) >> 1;
        this.loadRomBank(bank16kHi % this.nes.rom.romCount, 0xc000);
        break;
      }
      case 2: {
        // $8000-$BFFF from $5115, $C000-$DFFF from $5116, $E000-$FFFF from $5117
        let regA = this.prgBankReg[2]; // $5115
        if (regA & 0x80) {
          let bank16k = (regA & 0x7e) >> 1;
          this.loadRomBank(bank16k % this.nes.rom.romCount, 0x8000);
        }

        let regB = this.prgBankReg[3]; // $5116
        if (regB & 0x80) {
          this.load8kRomBank(regB & 0x7f, 0xc000);
        }

        let regC = this.prgBankReg[4]; // $5117
        this.load8kRomBank(regC & 0x7f, 0xe000);
        break;
      }
      case 3:
      default: {
        // Four 8K banks from $5114-$5117
        for (let i = 1; i <= 4; i++) {
          let reg = this.prgBankReg[i];
          let addr = 0x6000 + i * 0x2000; // $8000, $A000, $C000, $E000
          // $5117 (i=4) is always ROM; $5114-$5116 check bit 7
          if (i === 4 || reg & 0x80) {
            this.load8kRomBank(reg & 0x7f, addr);
          }
          // RAM banks are handled dynamically in load()
        }
        break;
      }
    }
  }

  // --- CHR Synchronization ---
  // Apply the current CHR bank registers to PPU pattern table memory.
  // See https://www.nesdev.org/wiki/MMC5#CHR_banking
  _syncChr() {
    // Trigger rendering before changing banks, so any accumulated scanlines
    // are drawn with the OLD CHR bank values. This is important for mid-frame
    // bank switches (e.g. via scanline IRQ handlers that change CHR registers
    // before writing to PPU scroll registers).
    this.nes.ppu.triggerRendering();

    // Invalidate cached CHR bank target so the render hooks re-apply
    // when rendering starts.
    this._chrBankTarget = -1;

    if (this.nes.ppu.f_spriteSize === 0) {
      // 8x8 sprite mode: only bank set A is used for ALL fetches (sprites,
      // backgrounds, and $2007 reads). Bank set B is completely ignored.
      // This was confirmed by hardware tests — see FCEUX bug #787.
      this._applyChrSetA();
      this._chrBankTarget = 0;
    }
    // In 8x16 sprite mode, the onBgRender/onSpriteRender hooks handle
    // switching between set A (sprites) and set B (backgrounds) during
    // rendering. Outside rendering (VBlank), $2007 reads use whichever
    // set was last loaded by the hooks — this is an acceptable simplification
    // since we can't call load*VromBank here (it triggers triggerRendering).
  }

  // Apply CHR bank set A ($5120-$5127) based on chrMode.
  _applyChrSetA() {
    if (this.nes.rom.vromCount === 0) return;

    switch (this.chrMode) {
      case 0:
        // 8K mode: $5127 selects an 8K page
        this.load8kVromBank((this.chrBankA[7] & 0xff) * 2, 0x0000);
        break;
      case 1:
        // 4K mode: $5123 selects 4K at $0000, $5127 selects 4K at $1000
        this.loadVromBank(this.chrBankA[3] & 0xff, 0x0000);
        this.loadVromBank(this.chrBankA[7] & 0xff, 0x1000);
        break;
      case 2:
        // 2K mode: $5121/$5123/$5125/$5127 each select 2K
        this.load2kVromBank(this.chrBankA[1] & 0x1ff, 0x0000);
        this.load2kVromBank(this.chrBankA[3] & 0x1ff, 0x0800);
        this.load2kVromBank(this.chrBankA[5] & 0x1ff, 0x1000);
        this.load2kVromBank(this.chrBankA[7] & 0x1ff, 0x1800);
        break;
      case 3:
      default:
        // 1K mode: $5120-$5127 each select a 1K page
        for (let i = 0; i < 8; i++) {
          this.load1kVromBank(this.chrBankA[i] & 0x3ff, i * 0x0400);
        }
        break;
    }
  }

  // Apply CHR bank set B ($5128-$512B) based on chrMode.
  // Set B uses only 4 registers, so larger modes replicate them.
  _applyChrSetB() {
    if (this.nes.rom.vromCount === 0) return;

    switch (this.chrMode) {
      case 0:
        // 8K mode: $512B selects an 8K page
        this.load8kVromBank((this.chrBankB[3] & 0xff) * 2, 0x0000);
        break;
      case 1:
        // 4K mode: $512B selects 4K at both halves
        this.loadVromBank(this.chrBankB[3] & 0xff, 0x0000);
        this.loadVromBank(this.chrBankB[3] & 0xff, 0x1000);
        break;
      case 2:
        // 2K mode: $5129/$512B each select 2K, replicated across 8K
        this.load2kVromBank(this.chrBankB[1] & 0x1ff, 0x0000);
        this.load2kVromBank(this.chrBankB[3] & 0x1ff, 0x0800);
        this.load2kVromBank(this.chrBankB[1] & 0x1ff, 0x1000);
        this.load2kVromBank(this.chrBankB[3] & 0x1ff, 0x1800);
        break;
      case 3:
      default:
        // 1K mode: $5128-$512B each select 1K, replicated for both halves
        for (let i = 0; i < 4; i++) {
          this.load1kVromBank(this.chrBankB[i] & 0x3ff, i * 0x0400);
          this.load1kVromBank(this.chrBankB[i] & 0x3ff, (i + 4) * 0x0400);
        }
        break;
    }
  }

  // --- Nametable Synchronization ---
  // Configure the PPU's vramMirrorTable AND internal NameTable objects to
  // reflect the MMC5's nametable mapping. Each of the 4 nametable slots
  // ($2000/$2400/$2800/$2C00) can be mapped to:
  //   0: NES CIRAM page A ($2000)
  //   1: NES CIRAM page B ($2400)
  //   2: ExRAM (internal 1KB, stored at $2800 in VRAM)
  //   3: Fill mode (stored at $2C00 in VRAM)
  //
  // IMPORTANT: The PPU uses TWO parallel data structures for nametables:
  //   1. vramMem[] + vramMirrorTable[] — raw bytes, for $2007 VRAM reads
  //   2. nameTable[0-3] + ntable1[0-3] — parsed tile/attrib, for rendering
  // We must update BOTH so the renderer sees the correct nametable data.
  // See https://www.nesdev.org/wiki/MMC5#Nametable_mapping
  _syncNametables() {
    let ppu = this.nes.ppu;

    // First, populate the fill-mode nametable at VRAM $2C00.
    // 960 bytes of tile index followed by 64 bytes of attribute.
    // The attribute byte packs the fill palette into all four sub-quadrants.
    let fillAttrByte =
      this.fillAttr |
      (this.fillAttr << 2) |
      (this.fillAttr << 4) |
      (this.fillAttr << 6);
    for (let i = 0; i < 960; i++) {
      ppu.vramMem[0x2c00 + i] = this.fillTile;
    }
    for (let i = 960; i < 1024; i++) {
      ppu.vramMem[0x2c00 + i] = fillAttrByte;
    }

    // Copy ExRAM into VRAM at $2800 for nametable use.
    // In modes 2/3 (general-purpose RAM), ExRAM reads as all zeros for nametable.
    if (this.exramMode >= 2) {
      for (let i = 0; i < 0x400; i++) {
        ppu.vramMem[0x2800 + i] = 0;
      }
    } else {
      copyArrayElements(this.exram, 0, ppu.vramMem, 0x2800, 0x400);
    }

    // Physical VRAM locations for each source:
    //   0 → $2000 (CIRAM A)
    //   1 → $2400 (CIRAM B)
    //   2 → $2800 (ExRAM copy)
    //   3 → $2C00 (Fill mode)
    const sourceBase = [0x2000, 0x2400, 0x2800, 0x2c00];

    for (let nt = 0; nt < 4; nt++) {
      let logicalBase = 0x2000 + nt * 0x400;
      let physBase = sourceBase[this.ntMapping[nt]];
      ppu.defineMirrorRegion(logicalBase, physBase, 0x400);
    }

    // Also mirror $3000-$3EFF → $2000-$2EFF as per normal NES behavior
    ppu.defineMirrorRegion(0x3000, 0x2000, 0xf00);

    // Update ntable1 so the renderer reads from the correct NameTable objects.
    // ntMapping values 0-3 map directly to NameTable indices 0-3:
    //   0 → NameTable 0 (CIRAM A, VRAM $2000)
    //   1 → NameTable 1 (CIRAM B, VRAM $2400)
    //   2 → NameTable 2 (ExRAM, VRAM $2800)
    //   3 → NameTable 3 (Fill, VRAM $2C00)
    for (let nt = 0; nt < 4; nt++) {
      ppu.ntable1[nt] = this.ntMapping[nt];
    }

    // Populate NameTable 2 with ExRAM data so the renderer can see it.
    // The PPU renderer reads from nameTable[].tile[] and nameTable[].attrib[],
    // NOT from vramMem directly, so we must sync both.
    this._populateNameTable(2, 0x2800);

    // Populate NameTable 3 with fill-mode data.
    this._populateNameTable(3, 0x2c00);
  }

  // Populate a NameTable object from a 1KB region of vramMem.
  // The first 960 bytes are tile indices, the next 64 are attribute table bytes.
  _populateNameTable(ntIndex, vramBase) {
    let ppu = this.nes.ppu;
    let nt = ppu.nameTable[ntIndex];

    // Copy tile indices (960 bytes = 30 rows × 32 columns)
    for (let i = 0; i < 960; i++) {
      nt.tile[i] = ppu.vramMem[vramBase + i];
    }

    // Decode attribute table (64 bytes) into per-tile attributes.
    // Each attribute byte controls a 4×4 tile area (32×32 pixels).
    for (let i = 0; i < 64; i++) {
      nt.writeAttrib(i, ppu.vramMem[vramBase + 960 + i]);
    }
  }

  // Sync a single ExRAM byte to both the VRAM copy at $2800 and NameTable 2.
  // Called when ExRAM is written via $5C00-$5FFF in modes 0/1.
  _syncExramToVram(exAddr) {
    if (this.exramMode < 2) {
      let ppu = this.nes.ppu;
      ppu.vramMem[0x2800 + exAddr] = this.exram[exAddr];

      // Also update NameTable 2 so the renderer sees the change.
      if (exAddr < 960) {
        // Tile index update
        ppu.nameTable[2].tile[exAddr] = this.exram[exAddr];
      } else if (exAddr < 1024) {
        // Attribute table update — decode into per-tile attributes
        ppu.nameTable[2].writeAttrib(exAddr - 960, this.exram[exAddr]);
      }
    }
  }

  // --- Expansion Audio ---
  // Write to a pulse channel register. Layout matches the NES APU square channels
  // ($4000-$4003) except that $5001/$5005 (sweep) has no effect on MMC5 pulses.
  _writePulse(pulse, reg, value) {
    switch (reg) {
      case 0:
        // $5000/$5004: Duty, length counter halt, constant volume, volume/envelope
        pulse.dutyCycle = (value >> 6) & 0x03;
        pulse.lengthHalt = (value & 0x20) !== 0;
        pulse.constantVolume = (value & 0x10) !== 0;
        pulse.volume = value & 0x0f;
        break;
      case 1:
        // $5001/$5005: Sweep — no effect on MMC5 pulse channels
        break;
      case 2:
        // $5002/$5006: Timer low 8 bits
        pulse.timer = (pulse.timer & 0x700) | value;
        break;
      case 3:
        // $5003/$5007: Length counter load, timer high 3 bits
        pulse.timer = (pulse.timer & 0x0ff) | ((value & 0x07) << 8);
        if (pulse.enabled) {
          pulse.lengthCounter = this.nes.papu.getLengthMax(value);
        }
        pulse.envelopeStart = true;
        pulse.sequencePos = 0;
        break;
    }
  }

  // --- Scanline IRQ Counter ---
  // Called by the PPU once per scanline when BG or sprites are enabled.
  // The PPU calls this at scanline 20 (pre-render) and scanlines 21-260 (visible).
  // The MMC5 uses an up-counter that resets when entering rendering and increments
  // each scanline, firing an IRQ when it matches the target value in $5203.
  // See https://www.nesdev.org/wiki/MMC5#Scanline_detection_and_scanline_IRQ
  clockIrqCounter() {
    let scanline = this.nes.ppu.scanline;

    if (scanline === 20) {
      // Pre-render scanline: entering active rendering.
      // Set in-frame and reset the scanline counter.
      this.inFrame = true;
      this.irqCounter = 0;
      return;
    }

    // Visible scanlines (21-260): increment counter and compare.
    this.irqCounter++;
    // $5203 value of 0 is a special case that never matches.
    if (this.irqTarget !== 0 && this.irqCounter === this.irqTarget) {
      this.irqPending = true;
      if (this.irqEnabled) {
        this.nes.cpu.requestIrq(this.nes.cpu.IRQ_NORMAL);
      }
    }

    // Clock expansion audio length counters once per scanline.
    // The MMC5 has no frame sequencer; length counters run at a fixed rate
    // tied to scanline timing. We approximate by clocking every 4 scanlines
    // (~240 Hz, matching the APU frame counter quarter-frame rate).
    // See https://www.nesdev.org/wiki/MMC5_audio
    if ((this.irqCounter & 3) === 0) {
      this._clockPulseLengthCounter(this.pulse1);
      this._clockPulseLengthCounter(this.pulse2);
    }
  }

  // Decrement a pulse channel's length counter if it's active and not halted.
  _clockPulseLengthCounter(pulse) {
    if (pulse.enabled && !pulse.lengthHalt && pulse.lengthCounter > 0) {
      pulse.lengthCounter--;
    }
  }

  // --- CHR Bank Switching for Sprite/BG Phases ---
  // The MMC5 uses dual CHR bank sets in 8x16 sprite mode ($2000 bit 5 = 1):
  //   - Bank set A ($5120-$5127) is used for sprite pattern fetches
  //   - Bank set B ($5128-$512B) is used for background pattern fetches
  // In 8x8 sprite mode, only bank set A is used for all fetches.
  // The PPU calls these hooks before each rendering phase so we can swap
  // the pattern table data in the ptTile cache.
  // See https://www.nesdev.org/wiki/MMC5#CHR_banking

  onBgRender() {
    if (this.nes.ppu.f_spriteSize === 1 && this._chrBankTarget !== 1) {
      this._applyChrSetB();
      this._chrBankTarget = 1;
      // Invalidate the PPU's tile cache since we swapped CHR data
      this.nes.ppu.validTileData = false;
    }
  }

  onSpriteRender() {
    if (this.nes.ppu.f_spriteSize === 1 && this._chrBankTarget !== 0) {
      this._applyChrSetA();
      this._chrBankTarget = 0;
    }
  }

  // Look up a sprite pattern tile from Set A's VROM banks directly.
  // In 8x16 mode, ptTile may have BG data (Set B) during BG rendering,
  // but sprite 0 hit detection needs Set A data. This method reads from
  // the pre-decoded VROM tile cache without modifying ptTile or calling
  // load*VromBank (which would trigger triggerRendering).
  // In 8x8 mode, ptTile already has Set A data from _syncChr(), so we
  // just return from ptTile directly.
  // See FCEUX's mmc5_PPURead() which uses separate MMC5SPRVPage/MMC5BGVPage
  // arrays instead of copying banks back and forth.
  getSpritePatternTile(index) {
    // In 8x8 mode, ptTile has the correct Set A data already
    if (this.nes.ppu.f_spriteSize !== 1 || this.nes.rom.vromCount === 0) {
      return this.nes.ppu.ptTile[index];
    }

    // In 8x16 mode, look up the tile from Set A's VROM banks.
    // The index maps to a slot in the 8KB pattern table space:
    //   index 0-255 → $0000-$0FFF, index 256-511 → $1000-$1FFF
    let vromCount = this.nes.rom.vromCount;
    let vromTile = this.nes.rom.vromTile;

    switch (this.chrMode) {
      case 0: {
        // 8K mode: chrBankA[7] selects an 8K page (two 4K banks)
        let bank4kStart = (this.chrBankA[7] & 0xff) * 2;
        let half = index >= 256 ? 1 : 0;
        let bank4k = (bank4kStart + half) % vromCount;
        return vromTile[bank4k][index - half * 256];
      }
      case 1: {
        // 4K mode: chrBankA[3] → $0000, chrBankA[7] → $1000
        let bank4k;
        if (index < 256) {
          bank4k = (this.chrBankA[3] & 0xff) % vromCount;
        } else {
          bank4k = (this.chrBankA[7] & 0xff) % vromCount;
        }
        return vromTile[bank4k][index % 256];
      }
      case 2: {
        // 2K mode: chrBankA[1]/[3]/[5]/[7] select four 2K chunks (128 tiles each)
        let regIndex = [1, 3, 5, 7];
        let slot = index >> 7; // 0-3
        let tileInSlot = index & 127;
        let bank2k = this.chrBankA[regIndex[slot]] & 0x1ff;
        let bank4k = Math.floor(bank2k / 2) % vromCount;
        return vromTile[bank4k][((bank2k % 2) << 7) + tileInSlot];
      }
      case 3:
      default: {
        // 1K mode: chrBankA[0-7] each select a 1K chunk (64 tiles each)
        let slot = index >> 6; // 0-7
        let tileInSlot = index & 63;
        let bank1k = this.chrBankA[slot] & 0x3ff;
        let bank4k = Math.floor(bank1k / 4) % vromCount;
        return vromTile[bank4k][((bank1k % 4) << 6) + tileInSlot];
      }
    }
  }

  // ExRAM mode 1 (extended attributes): per-tile CHR bank and palette override.
  // Each byte in ExRAM at $5C00-$5FFF corresponds to a nametable tile position:
  //   Bits 5-0: 4KB CHR bank number (combined with $5130 upper bits)
  //   Bits 7-6: Palette/attribute number for this tile
  // This replaces both the normal CHR bank set B and the attribute table for
  // background tiles, allowing each tile to independently select from up to
  // 16,384 unique background tiles. Used by Castlevania III for detailed BGs.
  // See https://www.nesdev.org/wiki/MMC5#Extended_RAM
  getBgTileData(baseTile, tileIndex, ht, vt) {
    if (this.exramMode !== 1 || this.nes.rom.vromCount === 0) return null;

    // ExRAM byte for this nametable tile position
    let exAddr = vt * 32 + ht;
    let exByte = this.exram[exAddr];

    // Bits 5-0 select a 4KB CHR bank, combined with chrUpperBits ($5130)
    // to form the full bank number: (upper << 6) | (exByte & 0x3F)
    let chrBank4k = (exByte & 0x3f) | (this.chrUpperBits << 6);
    let bank4k = chrBank4k % this.nes.rom.vromCount;

    // Look up the pre-decoded tile from VROM. The tile index (0-255) from
    // the nametable directly indexes into the selected 4KB bank.
    let tile = this.nes.rom.vromTile[bank4k][tileIndex];
    if (!tile) return null;

    // Bits 7-6 provide the attribute (palette number), replacing the
    // normal attribute table. Shift left by 2 to match PPU palette format.
    let attrib = ((exByte >> 6) & 0x03) << 2;

    return { tile, attrib };
  }

  // --- ROM Loading ---
  loadROM() {
    if (!this.nes.rom.valid) {
      throw new Error("MMC5: Invalid ROM! Unable to load.");
    }

    // Default PRG banking: last bank at $E000-$FFFF (mode 3 default)
    this.prgBankReg[4] = 0xff;
    this._syncPrg();

    // Load CHR-ROM if present
    this.loadCHRROM();

    // Load Battery RAM (if present)
    this.loadBatteryRam();

    // Initialize nametable mapping (default to vertical mirroring pattern)
    this._syncNametables();

    // Reset interrupt
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }

  // --- Save State Support ---
  toJSON() {
    let s = super.toJSON();
    s.prgMode = this.prgMode;
    s.prgBankReg = Array.from(this.prgBankReg);
    s.prgRam = Array.from(this.prgRam);
    s.prgRamProtectA = this.prgRamProtectA;
    s.prgRamProtectB = this.prgRamProtectB;
    s.chrMode = this.chrMode;
    s.chrBankA = Array.from(this.chrBankA);
    s.chrBankB = Array.from(this.chrBankB);
    s.chrUpperBits = this.chrUpperBits;
    s.lastChrWrite = this.lastChrWrite;
    s.ntMapping = Array.from(this.ntMapping);
    s.exramMode = this.exramMode;
    s.exram = Array.from(this.exram);
    s.fillTile = this.fillTile;
    s.fillAttr = this.fillAttr;
    s.irqTarget = this.irqTarget;
    s.irqEnabled = this.irqEnabled;
    s.irqPending = this.irqPending;
    s.inFrame = this.inFrame;
    s.irqCounter = this.irqCounter;
    s.multA = this.multA;
    s.multB = this.multB;
    s.splitEnabled = this.splitEnabled;
    s.splitRight = this.splitRight;
    s.splitTile = this.splitTile;
    s.splitScroll = this.splitScroll;
    s.splitPage = this.splitPage;
    s.pcmValue = this.pcmValue;
    s.pcmReadMode = this.pcmReadMode;
    s.pcmIrqEnabled = this.pcmIrqEnabled;
    s.audioEnabled = this.audioEnabled;
    s.pulse1 = Object.assign({}, this.pulse1);
    s.pulse2 = Object.assign({}, this.pulse2);
    return s;
  }

  fromJSON(s) {
    super.fromJSON(s);
    this.prgMode = s.prgMode;
    this.prgBankReg = new Uint8Array(s.prgBankReg);
    this.prgRam = new Uint8Array(s.prgRam);
    this.prgRamProtectA = s.prgRamProtectA;
    this.prgRamProtectB = s.prgRamProtectB;
    this.chrMode = s.chrMode;
    this.chrBankA = new Uint16Array(s.chrBankA);
    this.chrBankB = new Uint16Array(s.chrBankB);
    this.chrUpperBits = s.chrUpperBits;
    this.lastChrWrite = s.lastChrWrite;
    this.ntMapping = new Uint8Array(s.ntMapping);
    this.exramMode = s.exramMode;
    this.exram = new Uint8Array(s.exram);
    this.fillTile = s.fillTile;
    this.fillAttr = s.fillAttr;
    this.irqTarget = s.irqTarget;
    this.irqEnabled = s.irqEnabled;
    this.irqPending = s.irqPending;
    this.inFrame = s.inFrame;
    this.irqCounter = s.irqCounter;
    this.multA = s.multA;
    this.multB = s.multB;
    this.splitEnabled = s.splitEnabled;
    this.splitRight = s.splitRight;
    this.splitTile = s.splitTile;
    this.splitScroll = s.splitScroll;
    this.splitPage = s.splitPage;
    this.pcmValue = s.pcmValue;
    this.pcmReadMode = s.pcmReadMode;
    this.pcmIrqEnabled = s.pcmIrqEnabled;
    this.audioEnabled = s.audioEnabled;
    if (s.pulse1) this.pulse1 = Object.assign(this._initPulse(), s.pulse1);
    if (s.pulse2) this.pulse2 = Object.assign(this._initPulse(), s.pulse2);

    // Re-sync banks after loading state
    this._syncPrg();
    this._syncChr();
    this._syncNametables();
  }
}

/* harmony default export */ const mapper5 = (Mapper5);

;// ./src/mappers/mapper7.js


// AxROM (NES-AMROM, NES-ANROM, NES-AOROM)
// Used by games like Battletoads, Marble Madness, Wizards & Warriors.
// 32 KB switchable PRG-ROM bank (bits 0-2) with single-screen nametable mirroring
// select (bit 4). Uses CHR-RAM, no CHR bank switching.
// See https://www.nesdev.org/wiki/AxROM
class Mapper7 extends mapper0 {
  static mapperName = "AxROM";

  constructor(nes) {
    super(nes);
  }

  write(address, value) {
    // Writes to addresses other than MMC registers are handled by NoMapper.
    if (address < 0x8000) {
      super.write(address, value);
    } else {
      this.load32kRomBank(value & 0x7, 0x8000);
      if (value & 0x10) {
        this.nes.ppu.setMirroring(this.nes.rom.SINGLESCREEN_MIRRORING2);
      } else {
        this.nes.ppu.setMirroring(this.nes.rom.SINGLESCREEN_MIRRORING);
      }
    }
  }

  loadROM() {
    if (!this.nes.rom.valid) {
      throw new Error("AOROM: Invalid ROM! Unable to load.");
    }

    // Load PRG-ROM:
    this.loadPRGROM();

    // Load CHR-ROM:
    this.loadCHRROM();

    // Do Reset-Interrupt:
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }
}

/* harmony default export */ const mapper7 = (Mapper7);

;// ./src/mappers/mapper9.js


// MMC2 (PNROM / PEEOROM)
// Used exclusively by Mike Tyson's Punch-Out!! (and Punch-Out!!).
// Features tile-triggered CHR bank switching: two independent 4 KB CHR latches
// automatically swap between two banks when the PPU fetches specific tiles ($FD/$FE).
// PRG: 8 KB switchable at $8000, three 8 KB fixed banks at $A000-$FFFF.
// See https://www.nesdev.org/wiki/MMC2
class Mapper9 extends mapper0 {
  static mapperName = "MMC2";

  constructor(nes) {
    super(nes);

    // PRG bank register ($A000-$AFFF): selects 8 KB bank at $8000
    this.prgBank = 0;

    // CHR bank registers: each pattern table half has two possible banks,
    // selected by the corresponding latch state ($FD or $FE).
    this.chrBankFD0 = 0; // $B000: CHR bank for $0000 when latch0 = $FD
    this.chrBankFE0 = 0; // $C000: CHR bank for $0000 when latch0 = $FE
    this.chrBankFD1 = 0; // $D000: CHR bank for $1000 when latch1 = $FD
    this.chrBankFE1 = 0; // $E000: CHR bank for $1000 when latch1 = $FE

    // Latch states: $FD or $FE, one per pattern table half.
    // Both initialize to $FE on power-up.
    this.latch0 = 0xfe;
    this.latch1 = 0xfe;
  }

  write(address, value) {
    if (address < 0x8000) {
      super.write(address, value);
      return;
    }

    // Only the top nibble matters for register selection
    switch (address & 0xf000) {
      case 0xa000:
        // $A000-$AFFF: PRG bank select (bits 3-0 select 8 KB bank at $8000)
        this.prgBank = value & 0x0f;
        this.load8kRomBank(this.prgBank, 0x8000);
        break;

      case 0xb000:
        // $B000-$BFFF: CHR bank for $0000 when latch0 = $FD
        this.chrBankFD0 = value & 0x1f;
        this._updateChr0();
        break;

      case 0xc000:
        // $C000-$CFFF: CHR bank for $0000 when latch0 = $FE
        this.chrBankFE0 = value & 0x1f;
        this._updateChr0();
        break;

      case 0xd000:
        // $D000-$DFFF: CHR bank for $1000 when latch1 = $FD
        this.chrBankFD1 = value & 0x1f;
        this._updateChr1();
        break;

      case 0xe000:
        // $E000-$EFFF: CHR bank for $1000 when latch1 = $FE
        this.chrBankFE1 = value & 0x1f;
        this._updateChr1();
        break;

      case 0xf000:
        // $F000-$FFFF: Mirroring (bit 0: 0=vertical, 1=horizontal)
        if (value & 0x01) {
          this.nes.ppu.setMirroring(this.nes.rom.HORIZONTAL_MIRRORING);
        } else {
          this.nes.ppu.setMirroring(this.nes.rom.VERTICAL_MIRRORING);
        }
        break;
    }
  }

  // Load the correct CHR bank into $0000 based on latch0 state.
  _updateChr0() {
    let bank = this.latch0 === 0xfd ? this.chrBankFD0 : this.chrBankFE0;
    this.loadVromBank(bank, 0x0000);
  }

  // Load the correct CHR bank into $1000 based on latch1 state.
  _updateChr1() {
    let bank = this.latch1 === 0xfd ? this.chrBankFD1 : this.chrBankFE1;
    this.loadVromBank(bank, 0x1000);
  }

  // Called by the PPU when pattern table memory is accessed.
  // Updates the CHR latches based on the tile being fetched.
  // The latch switches AFTER the data has been read, so the
  // tile at $FD/$FE itself is rendered with the old bank.
  // See https://www.nesdev.org/wiki/MMC2#Latch_0_($0000-$0FFF)
  latchAccess(address) {
    // Only reload CHR banks when the latch state actually changes.
    // The same trigger tile may appear on many consecutive scanlines (e.g. a
    // column of $FD tiles in the nametable), and redundantly calling
    // loadVromBank on every fetch would copy 4 KB of VRAM each time.
    if (address === 0x0fd8) {
      // Latch 0 triggers on exactly $0FD8
      if (this.latch0 !== 0xfd) {
        this.latch0 = 0xfd;
        this._updateChr0();
      }
    } else if (address === 0x0fe8) {
      // Latch 0 triggers on exactly $0FE8
      if (this.latch0 !== 0xfe) {
        this.latch0 = 0xfe;
        this._updateChr0();
      }
    } else if (address >= 0x1fd8 && address <= 0x1fdf) {
      // Latch 1 triggers on $1FD8-$1FDF
      if (this.latch1 !== 0xfd) {
        this.latch1 = 0xfd;
        this._updateChr1();
      }
    } else if (address >= 0x1fe8 && address <= 0x1fef) {
      // Latch 1 triggers on $1FE8-$1FEF
      if (this.latch1 !== 0xfe) {
        this.latch1 = 0xfe;
        this._updateChr1();
      }
    }
  }

  loadROM() {
    if (!this.nes.rom.valid) {
      throw new Error("MMC2: Invalid ROM! Unable to load.");
    }

    // Load first switchable 8 KB PRG bank at $8000
    this.load8kRomBank(0, 0x8000);

    // Load the last three 8 KB PRG banks fixed at $A000-$FFFF
    let lastBank8k = (this.nes.rom.romCount - 1) * 2 + 1;
    this.load8kRomBank(lastBank8k - 2, 0xa000);
    this.load8kRomBank(lastBank8k - 1, 0xc000);
    this.load8kRomBank(lastBank8k, 0xe000);

    // Load CHR-ROM
    this.loadCHRROM();

    // Load Battery RAM (if present)
    this.loadBatteryRam();

    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }

  toJSON() {
    let s = super.toJSON();
    s.prgBank = this.prgBank;
    s.chrBankFD0 = this.chrBankFD0;
    s.chrBankFE0 = this.chrBankFE0;
    s.chrBankFD1 = this.chrBankFD1;
    s.chrBankFE1 = this.chrBankFE1;
    s.latch0 = this.latch0;
    s.latch1 = this.latch1;
    return s;
  }

  fromJSON(s) {
    super.fromJSON(s);
    this.prgBank = s.prgBank;
    this.chrBankFD0 = s.chrBankFD0;
    this.chrBankFE0 = s.chrBankFE0;
    this.chrBankFD1 = s.chrBankFD1;
    this.chrBankFE1 = s.chrBankFE1;
    this.latch0 = s.latch0;
    this.latch1 = s.latch1;
  }
}

/* harmony default export */ const mapper9 = (Mapper9);

;// ./src/mappers/mapper11.js


// Color Dreams (unlicensed discrete mapper)
// Used by games like Bible Adventures, Crystal Mines, Chiller, Metal Fighter.
// Single register at $8000-$FFFF: bits 0-1 select 32 KB PRG bank,
// bits 4-7 select 8 KB CHR bank.
// See https://www.nesdev.org/wiki/Color_Dreams
class Mapper11 extends mapper0 {
  static mapperName = "Color Dreams";

  constructor(nes) {
    super(nes);
  }

  write(address, value) {
    if (address < 0x8000) {
      super.write(address, value);
      return;
    } else {
      // Swap in the given PRG-ROM bank:
      let prgbank1 = ((value & 0xf) * 2) % this.nes.rom.romCount;
      let prgbank2 = ((value & 0xf) * 2 + 1) % this.nes.rom.romCount;

      this.loadRomBank(prgbank1, 0x8000);
      this.loadRomBank(prgbank2, 0xc000);

      if (this.nes.rom.vromCount > 0) {
        // Swap in the given VROM bank at 0x0000:
        let bank = ((value >> 4) * 2) % this.nes.rom.vromCount;
        this.loadVromBank(bank, 0x0000);
        this.loadVromBank(bank + 1, 0x1000);
      }
    }
  }
}

/* harmony default export */ const mapper11 = (Mapper11);

;// ./src/mappers/mapper34.js


// BNROM (NES-BNROM)
// Used by games like Deadly Towers (Mashou), Darkseed.
// Simple 32 KB PRG-ROM bank switching via writes to $8000-$FFFF.
// No CHR bank switching (uses CHR-RAM or fixed CHR-ROM).
// Note: iNES mapper 34 also covers NINA-001; this implementation handles BNROM only.
// See https://www.nesdev.org/wiki/INES_Mapper_034
class Mapper34 extends mapper0 {
  static mapperName = "BNROM";

  constructor(nes) {
    super(nes);
  }

  write(address, value) {
    if (address < 0x8000) {
      super.write(address, value);
      return;
    } else {
      this.load32kRomBank(value, 0x8000);
    }
  }
}

/* harmony default export */ const mapper34 = (Mapper34);

;// ./src/mappers/mapper38.js


// PCI556 (UNL-PCI556) - Bit Corp
// Used by Crime Busters.
// Nearly identical to GxROM (mapper 66) but the register is at $7000-$7FFF.
// Bits 0-1 select 32 KB PRG bank, bits 2-3 select 8 KB CHR bank.
// See https://www.nesdev.org/wiki/INES_Mapper_038
class Mapper38 extends mapper0 {
  static mapperName = "PCI556";

  constructor(nes) {
    super(nes);
  }

  write(address, value) {
    if (address < 0x7000 || address > 0x7fff) {
      super.write(address, value);
      return;
    } else {
      // Swap in the given PRG-ROM bank at 0x8000:
      this.load32kRomBank(value & 3, 0x8000);

      // Swap in the given VROM bank at 0x0000:
      this.load8kVromBank(((value >> 2) & 3) * 2, 0x0000);
    }
  }
}

/* harmony default export */ const mapper38 = (Mapper38);

;// ./src/mappers/mapper66.js


// GxROM (NES-GNROM, NES-MHROM)
// Used by games like Doraemon, Dragon Power, Gumshoe, Super Mario Bros. + Duck Hunt.
// Discrete mapper with 32 KB PRG and 8 KB CHR bank switching via a single register
// at $8000-$FFFF. Bits 4-5 select PRG bank, bits 0-1 select CHR bank.
// See https://www.nesdev.org/wiki/GxROM
class Mapper66 extends mapper0 {
  static mapperName = "GxROM";

  constructor(nes) {
    super(nes);
  }

  write(address, value) {
    if (address < 0x8000) {
      super.write(address, value);
      return;
    } else {
      // Swap in the given PRG-ROM bank at 0x8000:
      this.load32kRomBank((value >> 4) & 3, 0x8000);

      // Swap in the given VROM bank at 0x0000:
      this.load8kVromBank((value & 3) * 2, 0x0000);
    }
  }
}

/* harmony default export */ const mapper66 = (Mapper66);

;// ./src/mappers/mapper71.js


// Camerica/Codemasters mapper (BF9093/BF9097)
// Used by games like Fire Hawk, Micro Machines, Bee 52, MiG 29, etc.
// Largely a clone of UxROM with optional 1-screen mirroring control.
// See https://www.nesdev.org/wiki/INES_Mapper_071
class Mapper71 extends mapper0 {
  static mapperName = "Camerica";

  constructor(nes) {
    super(nes);
  }

  write(address, value) {
    if (address < 0x8000) {
      super.write(address, value);
      return;
    }

    if (address >= 0x9000 && address < 0xa000) {
      // $9000-$9FFF: 1-screen mirroring control (Fire Hawk / BF9097 variant)
      // Bit 4 selects which CIRAM nametable to fill all four screen slots
      if (value & 0x10) {
        this.nes.ppu.setMirroring(this.nes.rom.SINGLESCREEN_MIRRORING2);
      } else {
        this.nes.ppu.setMirroring(this.nes.rom.SINGLESCREEN_MIRRORING);
      }
    } else if (address >= 0xc000) {
      // $C000-$FFFF: PRG bank select (bits 3-0 select 16 KiB bank at $8000)
      this.loadRomBank(value & 0x0f, 0x8000);
    }
  }

  loadROM() {
    if (!this.nes.rom.valid) {
      throw new Error("Mapper 71: Invalid ROM! Unable to load.");
    }

    // Load first PRG bank at $8000, last at $C000 (fixed)
    this.loadRomBank(0, 0x8000);
    this.loadRomBank(this.nes.rom.romCount - 1, 0xc000);

    // Load CHR-ROM (usually CHR-RAM, so this may be a no-op)
    this.loadCHRROM();

    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }
}

/* harmony default export */ const mapper71 = (Mapper71);

;// ./src/mappers/mapper79.js


// NINA-03/NINA-06 (American Video Entertainment)
// Used by games like Tiles of Fate, Krazy Kreatures, Impossible Mission II.
// GxROM-like mapper with the register in the expansion area ($4100-$5FFF)
// instead of the cartridge space. Address decode: (addr & $E100) == $4100.
// Register format: .... PCCC
//   P (bit 3): selects 32 KB PRG bank
//   CCC (bits 0-2): selects 8 KB CHR bank
// See https://www.nesdev.org/wiki/INES_Mapper_079
class Mapper79 extends mapper0 {
  static mapperName = "NINA-03/NINA-06";

  constructor(nes) {
    super(nes);
  }

  write(address, value) {
    // The NINA register is active at addresses where (address & $E100) == $4100.
    // This covers $4100-$41FF, $4300-$43FF, $4500-$45FF, ... $5F00-$5FFF.
    if ((address & 0xe100) === 0x4100) {
      // Swap 32 KB PRG bank based on bit 3
      this.load32kRomBank((value >> 3) & 1, 0x8000);

      // Swap 8 KB CHR bank based on bits 0-2
      this.load8kVromBank((value & 7) * 2, 0x0000);
    }

    super.write(address, value);
  }
}

/* harmony default export */ const mapper79 = (Mapper79);

;// ./src/mappers/mapper94.js


// UN1ROM (HVC-UN1ROM)
// Used by Senjou no Ookami (Commando).
// UxROM variant where the bank number is in bits 2-4 instead of bits 0-2.
// 16 KB switchable PRG-ROM at $8000, last 16 KB bank fixed at $C000.
// See https://www.nesdev.org/wiki/INES_Mapper_094
class Mapper94 extends mapper0 {
  static mapperName = "UN1ROM";

  constructor(nes) {
    super(nes);
  }

  write(address, value) {
    // Writes to addresses other than MMC registers are handled by NoMapper.
    if (address < 0x8000) {
      super.write(address, value);
      return;
    } else {
      // This is a ROM bank select command.
      // Swap in the given ROM bank at 0x8000:
      this.loadRomBank(value >> 2, 0x8000);
    }
  }

  loadROM() {
    if (!this.nes.rom.valid) {
      throw new Error("UN1ROM: Invalid ROM! Unable to load.");
    }

    // Load PRG-ROM:
    this.loadRomBank(0, 0x8000);
    this.loadRomBank(this.nes.rom.romCount - 1, 0xc000);

    // Load CHR-ROM:
    this.loadCHRROM();

    // Do Reset-Interrupt:
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }
}

/* harmony default export */ const mapper94 = (Mapper94);

;// ./src/mappers/mapper118.js


// TxSROM - MMC3 variant with CHR-controlled nametable mirroring
// Used by games like Armadillo, Pro Sport Hockey, Goal! Two.
// Identical to standard MMC3 except: the $A000 mirroring register is bypassed,
// and bit 7 of CHR bank register values controls CIRAM A10 (nametable page select)
// instead of being used for CHR addressing. This enables single-screen and
// diagonal mirroring modes that standard MMC3 cannot produce.
// See https://www.nesdev.org/wiki/INES_Mapper_118
class Mapper118 extends mapper4 {
  static mapperName = "TxSROM";

  constructor(nes) {
    super(nes);
    // Raw CHR register values (R0-R5) — bit 7 is used for nametable control
    this.chrRegs = [0, 0, 0, 0, 0, 0];
  }

  write(address, value) {
    if (address === 0xa000) {
      // The standard MMC3 mirroring register is bypassed on TxSROM.
      // Nametable mirroring is instead controlled by bit 7 of CHR bank values.
      return;
    }
    super.write(address, value);
    if (address === 0x8000) {
      // chrAddressSelect may have changed, which affects which CHR registers
      // control which nametables
      this.updateNametableMirroring();
    }
  }

  executeCommand(cmd, arg) {
    if (cmd <= 5) {
      // CHR bank command: store the raw value, then mask bit 7 before passing
      // to the parent for CHR banking (bit 7 goes to CIRAM A10, not CHR A17)
      this.chrRegs[cmd] = arg;
      super.executeCommand(cmd, arg & 0x7f);
      this.updateNametableMirroring();
    } else {
      // PRG bank commands pass through unchanged
      super.executeCommand(cmd, arg);
    }
  }

  // Update nametable mirroring based on bit 7 of CHR register values.
  // The MMC3's CHR banking ignores A13, so pattern table addresses ($0xxx)
  // and nametable addresses ($2xxx) use the same bank selection. CHR A17
  // (bit 7) is wired to CIRAM A10 on TxSROM boards.
  //
  // When chrAddressSelect=0: R0/R1 (2KB banks) are at $0000-$0FFF, so they
  //   control nametables: R0 bit 7 → NT0+NT1, R1 bit 7 → NT2+NT3
  // When chrAddressSelect=1: R2-R5 (1KB banks) are at $0000-$0FFF, so they
  //   control individual nametables: R2→NT0, R3→NT1, R4→NT2, R5→NT3
  updateNametableMirroring() {
    let ppu = this.nes.ppu;

    if (this.chrAddressSelect === 0) {
      let nt01 = (this.chrRegs[0] >> 7) & 1;
      let nt23 = (this.chrRegs[1] >> 7) & 1;
      ppu.ntable1[0] = nt01;
      ppu.ntable1[1] = nt01;
      ppu.ntable1[2] = nt23;
      ppu.ntable1[3] = nt23;
    } else {
      ppu.ntable1[0] = (this.chrRegs[2] >> 7) & 1;
      ppu.ntable1[1] = (this.chrRegs[3] >> 7) & 1;
      ppu.ntable1[2] = (this.chrRegs[4] >> 7) & 1;
      ppu.ntable1[3] = (this.chrRegs[5] >> 7) & 1;
    }

    // Update VRAM mirror table to match ntable1 settings
    for (let i = 0; i < 4; i++) {
      let source = 0x2000 + i * 0x400;
      let target = 0x2000 + ppu.ntable1[i] * 0x400;
      ppu.defineMirrorRegion(source, target, 0x400);
    }

    // Invalidate the PPU's mirroring cache so setMirroring() won't skip
    // updates if called later
    ppu.currentMirroring = -1;
  }

  loadROM() {
    super.loadROM();
    this.updateNametableMirroring();
  }

  toJSON() {
    let s = super.toJSON();
    s.chrRegs = this.chrRegs.slice();
    return s;
  }

  fromJSON(s) {
    super.fromJSON(s);
    this.chrRegs = s.chrRegs;
    this.updateNametableMirroring();
  }
}

/* harmony default export */ const mapper118 = (Mapper118);

;// ./src/mappers/mapper119.js




// TQROM - MMC3 variant that supports both CHR ROM and CHR RAM simultaneously.
// Used by Pin-Bot and High Speed (both by Rare).
// Identical to standard MMC3 except: bit 6 of the CHR bank register values
// selects between CHR ROM (0) and CHR RAM (1). Bits 0-5 specify the bank
// within the selected chip, allowing up to 64KB CHR ROM and 8KB CHR RAM.
// A 74HC32 ORs PPU A13 with CHR A16 (bit 6) to generate the ROM chip-enable,
// while CHR A16 directly enables the RAM chip.
// See https://www.nesdev.org/wiki/INES_Mapper_119
class Mapper119 extends mapper4 {
  static mapperName = "TQROM";

  constructor(nes) {
    super(nes);

    // 8KB of CHR RAM (8 x 1KB banks)
    this.chrRam = new Uint8Array(8192);

    // Pre-decoded tiles for CHR RAM banks. Each 1KB bank has 64 tiles (1KB / 16
    // bytes per tile). These are persistent Tile objects: when a CHR RAM bank is
    // loaded into a PPU slot, ptTile entries point here, and PPU patternWrite()
    // updates them in place on $2007 writes.
    this.chrRamTiles = new Array(8);
    for (let i = 0; i < 8; i++) {
      this.chrRamTiles[i] = new Array(64);
      for (let j = 0; j < 64; j++) {
        this.chrRamTiles[i][j] = new tile();
      }
    }

    // Tracks which CHR RAM bank (0-7) is mapped at each 1KB PPU pattern table
    // slot (0-7 for addresses $0000-$1FFF), or -1 if CHR ROM is there.
    this.chrRamSlots = [-1, -1, -1, -1, -1, -1, -1, -1];
  }

  executeCommand(cmd, arg) {
    switch (cmd) {
      case mapper4.CMD_SEL_2_1K_VROM_0000: {
        // Select 2 consecutive 1KB banks at $0000/$0400 (or $1000/$1400)
        let base = this.chrAddressSelect === 0 ? 0x0000 : 0x1000;
        if (arg & 0x40) {
          let bank = arg & 0x06; // 2KB-aligned within CHR RAM
          this.load1kChrRamBank(bank, base);
          this.load1kChrRamBank(bank + 1, base + 0x0400);
        } else {
          let bank = arg & 0x3f;
          this.saveChrRamSlot(base);
          this.saveChrRamSlot(base + 0x0400);
          this.chrRamSlots[base >> 10] = -1;
          this.chrRamSlots[(base >> 10) + 1] = -1;
          this.load1kVromBank(bank, base);
          this.load1kVromBank(bank + 1, base + 0x0400);
        }
        break;
      }

      case mapper4.CMD_SEL_2_1K_VROM_0800: {
        let base = this.chrAddressSelect === 0 ? 0x0800 : 0x1800;
        if (arg & 0x40) {
          let bank = arg & 0x06;
          this.load1kChrRamBank(bank, base);
          this.load1kChrRamBank(bank + 1, base + 0x0400);
        } else {
          let bank = arg & 0x3f;
          this.saveChrRamSlot(base);
          this.saveChrRamSlot(base + 0x0400);
          this.chrRamSlots[base >> 10] = -1;
          this.chrRamSlots[(base >> 10) + 1] = -1;
          this.load1kVromBank(bank, base);
          this.load1kVromBank(bank + 1, base + 0x0400);
        }
        break;
      }

      case mapper4.CMD_SEL_1K_VROM_1000: {
        let base = this.chrAddressSelect === 0 ? 0x1000 : 0x0000;
        if (arg & 0x40) {
          this.load1kChrRamBank(arg & 0x07, base);
        } else {
          this.saveChrRamSlot(base);
          this.chrRamSlots[base >> 10] = -1;
          this.load1kVromBank(arg & 0x3f, base);
        }
        break;
      }

      case mapper4.CMD_SEL_1K_VROM_1400: {
        let base = this.chrAddressSelect === 0 ? 0x1400 : 0x0400;
        if (arg & 0x40) {
          this.load1kChrRamBank(arg & 0x07, base);
        } else {
          this.saveChrRamSlot(base);
          this.chrRamSlots[base >> 10] = -1;
          this.load1kVromBank(arg & 0x3f, base);
        }
        break;
      }

      case mapper4.CMD_SEL_1K_VROM_1800: {
        let base = this.chrAddressSelect === 0 ? 0x1800 : 0x0800;
        if (arg & 0x40) {
          this.load1kChrRamBank(arg & 0x07, base);
        } else {
          this.saveChrRamSlot(base);
          this.chrRamSlots[base >> 10] = -1;
          this.load1kVromBank(arg & 0x3f, base);
        }
        break;
      }

      case mapper4.CMD_SEL_1K_VROM_1C00: {
        let base = this.chrAddressSelect === 0 ? 0x1c00 : 0x0c00;
        if (arg & 0x40) {
          this.load1kChrRamBank(arg & 0x07, base);
        } else {
          this.saveChrRamSlot(base);
          this.chrRamSlots[base >> 10] = -1;
          this.load1kVromBank(arg & 0x3f, base);
        }
        break;
      }

      default:
        // PRG commands (6, 7) pass through to MMC3
        super.executeCommand(cmd, arg);
    }
  }

  // Save the current vramMem content of a 1KB PPU slot back to chrRam.
  // This must be called before overwriting a slot that has CHR RAM mapped,
  // so that any PPU $2007 writes to that region are preserved.
  saveChrRamSlot(address) {
    let slot = address >> 10;
    let bank = this.chrRamSlots[slot];
    if (bank === -1) return;
    copyArrayElements(
      this.nes.ppu.vramMem,
      slot << 10,
      this.chrRam,
      bank * 1024,
      1024,
    );
  }

  // Load a 1KB CHR RAM bank into the PPU pattern table at the given address.
  load1kChrRamBank(bank, address) {
    this.nes.ppu.triggerRendering();
    bank &= 0x07;

    // Save the old CHR RAM content if this slot had a different bank mapped
    this.saveChrRamSlot(address);

    let slot = address >> 10;
    this.chrRamSlots[slot] = bank;

    // Copy CHR RAM data into PPU VRAM
    let srcOffset = bank * 1024;
    copyArrayElements(
      this.chrRam,
      srcOffset,
      this.nes.ppu.vramMem,
      address,
      1024,
    );

    // Rebuild tiles from CHR RAM data and install them in ppuTile
    this.rebuildChrRamTiles(bank);
    let baseIndex = address >> 4;
    for (let i = 0; i < 64; i++) {
      this.nes.ppu.ptTile[baseIndex + i] = this.chrRamTiles[bank][i];
    }
  }

  // Rebuild the pre-decoded Tile objects for a CHR RAM bank from raw bytes.
  rebuildChrRamTiles(bank) {
    let base = bank * 1024;
    for (let i = 0; i < 1024; i++) {
      let tileIndex = i >> 4;
      let leftOver = i % 16;
      if (leftOver < 8) {
        this.chrRamTiles[bank][tileIndex].setScanline(
          leftOver,
          this.chrRam[base + i],
          this.chrRam[base + i + 8],
        );
      } else {
        this.chrRamTiles[bank][tileIndex].setScanline(
          leftOver - 8,
          this.chrRam[base + i - 8],
          this.chrRam[base + i],
        );
      }
    }
  }

  // Allow PPU writes to pattern table addresses that are mapped to CHR RAM.
  canWriteChr(address) {
    if (address >= 0x2000) return false;
    return this.chrRamSlots[address >> 10] !== -1;
  }

  toJSON() {
    // Flush any pending CHR RAM writes from vramMem back to chrRam
    for (let slot = 0; slot < 8; slot++) {
      this.saveChrRamSlot(slot << 10);
    }
    let s = super.toJSON();
    s.chrRam = Array.from(this.chrRam);
    s.chrRamSlots = this.chrRamSlots.slice();
    return s;
  }

  fromJSON(s) {
    super.fromJSON(s);
    this.chrRam = new Uint8Array(s.chrRam);
    this.chrRamSlots = s.chrRamSlots;
    // Rebuild all CHR RAM tile data
    for (let bank = 0; bank < 8; bank++) {
      this.rebuildChrRamTiles(bank);
    }
    // Re-install CHR RAM tiles into PPU ptTile for active slots
    for (let slot = 0; slot < 8; slot++) {
      let bank = this.chrRamSlots[slot];
      if (bank !== -1) {
        let baseIndex = (slot << 10) >> 4;
        for (let i = 0; i < 64; i++) {
          this.nes.ppu.ptTile[baseIndex + i] = this.chrRamTiles[bank][i];
        }
      }
    }
  }
}

/* harmony default export */ const mapper119 = (Mapper119);

;// ./src/mappers/mapper140.js


// Jaleco JF-11 / JF-14
// Used by Bio Senshi Dan - Increaser Tono Tatakai.
// Similar to GxROM (mapper 66) but register is at $6000-$7FFF instead of $8000+,
// which means it cannot coexist with SRAM. Bits 4-5 select 32 KB PRG bank,
// bits 0-3 select 8 KB CHR bank.
// See https://www.nesdev.org/wiki/INES_Mapper_140
class Mapper140 extends mapper0 {
  static mapperName = "Jaleco JF-11/JF-14";

  constructor(nes) {
    super(nes);
  }

  write(address, value) {
    if (address < 0x6000 || address > 0x7fff) {
      super.write(address, value);
      return;
    } else {
      // Swap in the given PRG-ROM bank at 0x8000:
      this.load32kRomBank((value >> 4) & 3, 0x8000);

      // Swap in the given VROM bank at 0x0000:
      this.load8kVromBank((value & 0xf) * 2, 0x0000);
    }
  }
}

/* harmony default export */ const mapper140 = (Mapper140);

;// ./src/mappers/mapper180.js


// UNROM (AND-logic variant, HVC-UNROM)
// Used by Crazy Climber.
// Inverted UxROM: first 16 KB bank fixed at $8000, switchable bank at $C000.
// Standard UxROM fixes the last bank; this variant uses AND logic instead of OR logic
// on the bank select lines, producing the opposite fixed-bank behavior.
// See https://www.nesdev.org/wiki/INES_Mapper_180
class Mapper180 extends mapper0 {
  static mapperName = "UNROM (Crazy Climber)";

  constructor(nes) {
    super(nes);
  }

  write(address, value) {
    // Writes to addresses other than MMC registers are handled by NoMapper.
    if (address < 0x8000) {
      super.write(address, value);
      return;
    } else {
      // This is a ROM bank select command.
      // Swap in the given ROM bank at 0xc000:
      this.loadRomBank(value, 0xc000);
    }
  }

  loadROM() {
    if (!this.nes.rom.valid) {
      throw new Error("Mapper 180: Invalid ROM! Unable to load.");
    }

    // Load PRG-ROM:
    this.loadRomBank(0, 0x8000);
    this.loadRomBank(0, 0xc000);

    // Load CHR-ROM:
    this.loadCHRROM();

    // Do Reset-Interrupt:
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }
}

/* harmony default export */ const mapper180 = (Mapper180);

;// ./src/mappers/mapper240.js


// Mapper 240 (Jing Ke Xin Zhuan / Sheng Huo Lie Zhuan PCBs)
// Used by Jing Ke Xin Zhuan, Sheng Huo Lie Zhuan.
// Register at $4020-$5FFF: upper nibble selects 32 KB PRG bank,
// lower nibble selects 8 KB CHR bank.
// See https://www.nesdev.org/wiki/INES_Mapper_240
class Mapper240 extends mapper0 {
  static mapperName = "Mapper 240";

  constructor(nes) {
    super(nes);
  }

  write(address, value) {
    if (address < 0x4020 || address > 0x5fff) {
      super.write(address, value);
      return;
    } else {
      // Swap in the given PRG-ROM bank at 0x8000:
      this.load32kRomBank((value >> 4) & 3, 0x8000);

      // Swap in the given VROM bank at 0x0000:
      this.load8kVromBank((value & 0xf) * 2, 0x0000);
    }
  }
}

/* harmony default export */ const mapper240 = (Mapper240);

;// ./src/mappers/mapper241.js


// BxROM variant (Hengge Technology)
// Used by various Hengge Technology titles and educational cartridges.
// BxROM-like 32 KB PRG bank switching via writes to $8000-$FFFF,
// with optional battery-backed WRAM at $6000-$7FFF.
// See https://www.nesdev.org/wiki/INES_Mapper_241
class Mapper241 extends mapper0 {
  static mapperName = "BxROM (Mapper 241)";

  constructor(nes) {
    super(nes);
  }

  write(address, value) {
    if (address < 0x8000) {
      super.write(address, value);
      return;
    } else {
      this.load32kRomBank(value, 0x8000);
    }
  }
}

/* harmony default export */ const mapper241 = (Mapper241);

;// ./src/mappers/index.js






















/* harmony default export */ const mappers = ({
  0: mapper0,
  1: mapper1,
  2: mapper2,
  3: mapper3,
  4: mapper4,
  5: mapper5,
  7: mapper7,
  9: mapper9,
  11: mapper11,
  34: mapper34,
  38: mapper38,
  66: mapper66,
  71: mapper71,
  79: mapper79,
  94: mapper94,
  118: mapper118,
  119: mapper119,
  140: mapper140,
  180: mapper180,
  240: mapper240,
  241: mapper241,
});

;// ./src/rom.js



class ROM {
  // Mirroring types (instance properties so they're accessible via
  // this.nes.rom.HORIZONTAL_MIRRORING etc. in PPU and mappers):
  VERTICAL_MIRRORING = 0;
  HORIZONTAL_MIRRORING = 1;
  FOURSCREEN_MIRRORING = 2;
  SINGLESCREEN_MIRRORING = 3;
  SINGLESCREEN_MIRRORING2 = 4;
  SINGLESCREEN_MIRRORING3 = 5;
  SINGLESCREEN_MIRRORING4 = 6;
  CHRROM_MIRRORING = 7;

  constructor(nes) {
    this.nes = nes;
    this.valid = false;
  }

  load(data) {
    let i, j, v;

    // Accept Uint8Array, ArrayBuffer, Buffer, or binary string.
    if (data instanceof ArrayBuffer) {
      data = new Uint8Array(data);
    }
    const isTypedArray = ArrayBuffer.isView(data);

    if (isTypedArray) {
      if (
        data.length < 4 ||
        data[0] !== 0x4e ||
        data[1] !== 0x45 ||
        data[2] !== 0x53 ||
        data[3] !== 0x1a
      ) {
        throw new Error("Not a valid NES ROM.");
      }
    } else {
      if (!data.startsWith("NES\x1a")) {
        throw new Error("Not a valid NES ROM.");
      }
    }

    this.header = new Uint8Array(16);
    for (i = 0; i < 16; i++) {
      this.header[i] = isTypedArray ? data[i] : data.charCodeAt(i) & 0xff;
    }

    // Flags from byte 6 (shared between iNES 1.0 and NES 2.0)
    this.mirroring = (this.header[6] & 1) !== 0 ? 1 : 0;
    this.batteryRam = (this.header[6] & 2) !== 0;
    this.trainer = (this.header[6] & 4) !== 0;
    this.fourScreen = (this.header[6] & 8) !== 0;

    // Detect NES 2.0: byte 7 bits 3..2 == 0b10
    // https://www.nesdev.org/wiki/NES_2.0
    this.isNES2 = (this.header[7] & 0x0c) === 0x08;

    if (this.isNES2) {
      this._loadNES2Header();
    } else {
      this._loadINES1Header();
    }

    /* TODO
        if (this.batteryRam)
            this.loadBatteryRam();*/

    // Load PRG-ROM banks:
    this.rom = new Array(this.romCount);
    // Skip past the 16-byte header, plus 512-byte trainer if present.
    // See https://www.nesdev.org/wiki/INES#Trainer
    let offset = 16 + (this.trainer ? 512 : 0);
    for (i = 0; i < this.romCount; i++) {
      this.rom[i] = new Uint8Array(16384);
      for (j = 0; j < 16384; j++) {
        if (offset + j >= data.length) {
          break;
        }
        this.rom[i][j] = isTypedArray
          ? data[offset + j]
          : data.charCodeAt(offset + j) & 0xff;
      }
      offset += 16384;
    }
    // Load CHR-ROM banks:
    this.vrom = new Array(this.vromCount);
    for (i = 0; i < this.vromCount; i++) {
      this.vrom[i] = new Uint8Array(4096);
      for (j = 0; j < 4096; j++) {
        if (offset + j >= data.length) {
          break;
        }
        this.vrom[i][j] = isTypedArray
          ? data[offset + j]
          : data.charCodeAt(offset + j) & 0xff;
      }
      offset += 4096;
    }

    // Create VROM tiles:
    this.vromTile = new Array(this.vromCount);
    for (i = 0; i < this.vromCount; i++) {
      this.vromTile[i] = new Array(256);
      for (j = 0; j < 256; j++) {
        this.vromTile[i][j] = new tile();
      }
    }

    // Convert CHR-ROM banks to tiles:
    let tileIndex;
    let leftOver;
    for (v = 0; v < this.vromCount; v++) {
      for (i = 0; i < 4096; i++) {
        tileIndex = i >> 4;
        leftOver = i % 16;
        if (leftOver < 8) {
          this.vromTile[v][tileIndex].setScanline(
            leftOver,
            this.vrom[v][i],
            this.vrom[v][i + 8],
          );
        } else {
          this.vromTile[v][tileIndex].setScanline(
            leftOver - 8,
            this.vrom[v][i - 8],
            this.vrom[v][i],
          );
        }
      }
    }

    this.valid = true;
  }

  // Parse iNES 1.0 header fields (bytes 4-15).
  _loadINES1Header() {
    this.romCount = this.header[4];
    this.vromCount = this.header[5] * 2; // Get the number of 4kB banks, not 8kB
    this.mapperType = (this.header[6] >> 4) | (this.header[7] & 0xf0);

    // Check whether bytes 8-15 are zero. Non-zero values in this region
    // typically indicate garbage (e.g. "DiskDude!" in old ROM dumps), so
    // we discard the upper mapper nibble from byte 7 to be safe.
    let foundError = false;
    for (let i = 8; i < 16; i++) {
      if (this.header[i] !== 0) {
        foundError = true;
        break;
      }
    }
    if (foundError) {
      this.mapperType &= 0xf; // Ignore byte 7
    }

    // Default NES 2.0 fields to zero for iNES 1.0 ROMs so consumers
    // don't need to check isNES2 before accessing them.
    this.subMapper = 0;
    this.prgRamSize = 0;
    this.prgNvRamSize = 0;
    this.chrRamSize = 0;
    this.chrNvRamSize = 0;
    this.timingMode = 0;
    this.consoleType = 0;
  }

  // Parse NES 2.0 header fields (bytes 4-15).
  // https://www.nesdev.org/wiki/NES_2.0
  _loadNES2Header() {
    // Mapper number: 12 bits from bytes 6, 7, and 8.
    //   Byte 6 D7..D4: mapper D3..D0
    //   Byte 7 D7..D4: mapper D7..D4
    //   Byte 8 D3..D0: mapper D11..D8
    this.mapperType =
      (this.header[6] >> 4) |
      (this.header[7] & 0xf0) |
      ((this.header[8] & 0x0f) << 8);

    // Submapper: byte 8 D7..D4
    this.subMapper = (this.header[8] >> 4) & 0x0f;

    // PRG-ROM size: byte 9 D3..D0 (MSB) combined with byte 4 (LSB).
    // When MSB nibble is 0xF, an exponent-multiplier encoding is used:
    //   size = 2^E * (M*2 + 1) bytes, where E = bits 7..2, M = bits 1..0.
    const prgMsb = this.header[9] & 0x0f;
    if (prgMsb === 0x0f) {
      const e = (this.header[4] >> 2) & 0x3f;
      const m = this.header[4] & 0x03;
      this.romCount = Math.ceil((Math.pow(2, e) * (m * 2 + 1)) / 16384);
    } else {
      this.romCount = (prgMsb << 8) | this.header[4];
    }

    // CHR-ROM size: byte 9 D7..D4 (MSB) combined with byte 5 (LSB).
    // Same exponent-multiplier encoding when MSB nibble is 0xF.
    // Internally we store as 4KB bank count (vromCount = 8KB units * 2).
    const chrMsb = (this.header[9] >> 4) & 0x0f;
    if (chrMsb === 0x0f) {
      const e = (this.header[5] >> 2) & 0x3f;
      const m = this.header[5] & 0x03;
      this.vromCount = Math.ceil((Math.pow(2, e) * (m * 2 + 1)) / 4096);
    } else {
      // 12-bit value is in 8KB units; double it for 4KB bank count.
      this.vromCount = ((chrMsb << 8) | this.header[5]) * 2;
    }

    // PRG-RAM sizes (byte 10).
    // Lower nibble: volatile PRG-RAM; upper nibble: non-volatile PRG-NVRAM.
    // Encoding: 0 = none, otherwise 64 << value bytes.
    this.prgRamSize = ROM._decodeRamSize(this.header[10] & 0x0f);
    this.prgNvRamSize = ROM._decodeRamSize((this.header[10] >> 4) & 0x0f);

    // CHR-RAM sizes (byte 11).
    // Lower nibble: volatile CHR-RAM; upper nibble: non-volatile CHR-NVRAM.
    // Note: with NES 2.0, do not assume 8KB CHR-RAM when CHR-ROM is 0;
    // CHR-RAM must be explicitly specified here.
    this.chrRamSize = ROM._decodeRamSize(this.header[11] & 0x0f);
    this.chrNvRamSize = ROM._decodeRamSize((this.header[11] >> 4) & 0x0f);

    // CPU/PPU timing mode (byte 12, low 2 bits).
    // 0 = NTSC (RP2C02), 1 = PAL (RP2C07), 2 = Multi-region, 3 = Dendy (UA6538)
    this.timingMode = this.header[12] & 0x03;

    // Console type (byte 7, bits 1..0).
    // 0 = NES/Famicom, 1 = Vs. System, 2 = Playchoice 10, 3 = Extended
    this.consoleType = this.header[7] & 0x03;
  }

  // Decode NES 2.0 RAM shift-count encoding.
  // Value 0 means no RAM; otherwise size = 64 << value (in bytes).
  // https://www.nesdev.org/wiki/NES_2.0#PRG-(NV)RAM/EEPROM
  static _decodeRamSize(value) {
    if (value === 0) return 0;
    return 64 << value;
  }

  getMirroringType() {
    if (this.fourScreen) {
      return this.FOURSCREEN_MIRRORING;
    }
    if (this.mirroring === 0) {
      return this.HORIZONTAL_MIRRORING;
    }
    return this.VERTICAL_MIRRORING;
  }

  mapperSupported() {
    return typeof mappers[this.mapperType] !== "undefined";
  }

  createMapper() {
    if (this.mapperSupported()) {
      return new mappers[this.mapperType](this.nes);
    } else {
      throw new Error(`Unsupported mapper: ${this.mapperType}`);
    }
  }
}

/* harmony default export */ const rom = (ROM);

;// ./src/nes.js







class NES {
  constructor(opts) {
    this.opts = {
      onFrame: function () {},
      onAudioSample: null,
      onStatusUpdate: function () {},
      onBatteryRamWrite: function () {},

      emulateSound: true,
      sampleRate: 48000, // Sound sample rate in hz

      ...opts,
    };

    this.ui = {
      writeFrame: this.opts.onFrame,
      updateStatus: this.opts.onStatusUpdate,
    };
    this.cpu = new cpu(this);
    this.ppu = new ppu(this);
    this.papu = new papu(this);
    this.gameGenie = new gamegenie();
    this.gameGenie.onChange = () => this.cpu._updateCartridgeLoader();
    this.mmap = null;
    this.controllers = {
      1: new controller(),
      2: new controller(),
    };

    this.fpsFrameCount = 0;
    this.romData = null;

    this.ui.updateStatus("Ready to load a ROM.");
  }

  // Resets the system
  reset() {
    this.cpu = new cpu(this);
    this.ppu = new ppu(this);
    this.papu = new papu(this);

    if (this.mmap !== null) {
      this.mmap = this.rom.createMapper();
    }

    this.lastFpsTime = null;
    this.fpsFrameCount = 0;

    this.crashed = false;
  }

  // The frame loop. PPU is advanced inline after every CPU bus operation
  // (in cpu.load/write/push/pull). APU is clocked in bulk after each
  // instruction for compatibility with its sample timing logic.
  frame = () => {
    if (this.crashed) {
      throw new Error(
        "Game has crashed. Call reset() or loadROM() to restart.",
      );
    }
    this.controllers[1].clock();
    this.controllers[2].clock();
    this.ppu.startFrame();
    let cycles;
    const cpu = this.cpu;
    const ppu = this.ppu;
    const papu = this.papu;
    try {
      for (;;) {
        if (cpu.cyclesToHalt === 0) {
          // Execute a CPU instruction. PPU advancement happens inline
          // inside the bus operations (load/write/push/pull).
          cycles = cpu.emulate();

          // Clock APU with the full cycle count. The frame counter portion
          // subtracts any cycles already advanced by APU catch-up.
          papu.clockFrameCounter(cycles, cpu.apuCatchupCycles);
          cpu.apuCatchupCycles = 0;

          // Check if VBlank fired during inline PPU stepping.
          if (ppu.frameEnded) {
            ppu.frameEnded = false;
            break;
          }
        } else {
          // DMA halt cycles: step PPU per cycle. APU is clocked in bulk.
          let chunk = Math.min(cpu.cyclesToHalt, 8);
          for (let i = 0; i < chunk; i++) {
            ppu.advanceDots(3);
          }
          papu.clockFrameCounter(chunk);
          cpu.cyclesToHalt -= chunk;
          cpu._cpuCycleBase += chunk;

          if (ppu.frameEnded) {
            ppu.frameEnded = false;
            break;
          }
        }
      }
    } catch (e) {
      this.crashed = true;
      throw e;
    }
    this.fpsFrameCount++;
  };

  buttonDown = (controller, button) => {
    this.controllers[controller].buttonDown(button);
  };

  buttonUp = (controller, button) => {
    this.controllers[controller].buttonUp(button);
  };

  zapperMove = (x, y) => {
    if (!this.mmap) return;
    this.mmap.zapperX = x;
    this.mmap.zapperY = y;
  };

  zapperFireDown = () => {
    if (!this.mmap) return;
    this.mmap.zapperFired = true;
  };

  zapperFireUp = () => {
    if (!this.mmap) return;
    this.mmap.zapperFired = false;
  };

  getFPS() {
    const now = Date.now();
    let fps = null;
    if (this.lastFpsTime) {
      fps = this.fpsFrameCount / ((now - this.lastFpsTime) / 1000);
    }
    this.fpsFrameCount = 0;
    this.lastFpsTime = now;
    return fps;
  }

  reloadROM() {
    if (this.romData !== null) {
      this.loadROM(this.romData);
    }
  }

  // Loads a ROM file into the CPU and PPU.
  // The ROM file is validated first.
  loadROM(data) {
    // Load ROM file:
    this.rom = new rom(this);
    this.rom.load(data);

    this.reset();
    this.mmap = this.rom.createMapper();
    this.mmap.loadROM();
    this.ppu.setMirroring(this.rom.getMirroringType());
    this.romData = data;
  }

  // Adjust audio sample timing for a non-standard host frame rate. At the
  // default 60fps each frame() produces ~800 samples at 48kHz. If the host
  // calls frame() less often (e.g. 30fps), the sample timer must fire more
  // frequently per CPU cycle so each frame still fills the audio buffer.
  setFramerate(rate) {
    this.papu.setFrameRate(rate);
  }

  toJSON() {
    return {
      // romData: this.romData,
      cpu: this.cpu.toJSON(),
      mmap: this.mmap.toJSON(),
      ppu: this.ppu.toJSON(),
      papu: this.papu.toJSON(),
      controllers: {
        1: this.controllers[1].toJSON(),
        2: this.controllers[2].toJSON(),
      },
    };
  }

  fromJSON(s) {
    this.reset();
    // this.romData = s.romData;
    this.cpu.fromJSON(s.cpu);
    this.mmap.fromJSON(s.mmap);
    this.ppu.fromJSON(s.ppu);
    this.papu.fromJSON(s.papu);
    if (s.controllers) {
      if (s.controllers[1]) this.controllers[1].fromJSON(s.controllers[1]);
      if (s.controllers[2]) this.controllers[2].fromJSON(s.controllers[2]);
    }
  }
}

/* harmony default export */ const nes = (NES);

;// ./src/browser/screen.js
const SCREEN_WIDTH = 256;
const SCREEN_HEIGHT = 240;

class Screen {
  constructor(container, options = {}) {
    this.onMouseDown = options.onMouseDown;
    this.onMouseUp = options.onMouseUp;

    // Create canvas element
    this.canvas = document.createElement("canvas");
    this.canvas.width = SCREEN_WIDTH;
    this.canvas.height = SCREEN_HEIGHT;
    this.canvas.style.imageRendering = "pixelated";
    this.canvas.style.imageRendering = "crisp-edges";
    container.appendChild(this.canvas);

    // Mouse events for Zapper support
    this._handleMouseDown = (e) => {
      if (!this.onMouseDown) return;
      // Make coordinates unscaled
      let scale = SCREEN_WIDTH / parseFloat(this.canvas.style.width);
      let rect = this.canvas.getBoundingClientRect();
      let x = Math.round((e.clientX - rect.left) * scale);
      let y = Math.round((e.clientY - rect.top) * scale);
      this.onMouseDown(x, y);
    };
    this._handleMouseUp = () => {
      if (this.onMouseUp) this.onMouseUp();
    };
    this.canvas.addEventListener("mousedown", this._handleMouseDown);
    this.canvas.addEventListener("mouseup", this._handleMouseUp);

    this._initCanvas();
  }

  _initCanvas() {
    this.context = this.canvas.getContext("2d");
    this.imageData = this.context.getImageData(
      0,
      0,
      SCREEN_WIDTH,
      SCREEN_HEIGHT,
    );

    this.context.fillStyle = "black";
    // set alpha to opaque
    this.context.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

    // buffer to write on next animation frame
    this.buf = new ArrayBuffer(this.imageData.data.length);
    // Get the canvas buffer in 8bit and 32bit
    this.buf8 = new Uint8ClampedArray(this.buf);
    this.buf32 = new Uint32Array(this.buf);

    // Set alpha
    for (var i = 0; i < this.buf32.length; ++i) {
      this.buf32[i] = 0xff000000;
    }
  }

  setBuffer = (buffer) => {
    for (var y = 0; y < SCREEN_HEIGHT; ++y) {
      for (var x = 0; x < SCREEN_WIDTH; ++x) {
        var i = y * 256 + x;
        // Convert pixel from NES BGR to canvas ABGR
        this.buf32[i] = 0xff000000 | buffer[i]; // Full alpha
      }
    }
  };

  writeBuffer = () => {
    this.imageData.data.set(this.buf8);
    this.context.putImageData(this.imageData, 0, 0);
  };

  fitInParent = () => {
    let parent = this.canvas.parentNode;
    let parentWidth = parent.clientWidth;
    let parentHeight = parent.clientHeight;
    let parentRatio = parentWidth / parentHeight;
    let desiredRatio = SCREEN_WIDTH / SCREEN_HEIGHT;
    if (desiredRatio < parentRatio) {
      this.canvas.style.width = `${Math.round(parentHeight * desiredRatio)}px`;
      this.canvas.style.height = `${parentHeight}px`;
    } else {
      this.canvas.style.width = `${parentWidth}px`;
      this.canvas.style.height = `${Math.round(parentWidth / desiredRatio)}px`;
    }
  };

  screenshot() {
    var img = new Image();
    img.src = this.canvas.toDataURL("image/png");
    return img;
  }

  destroy() {
    this.canvas.removeEventListener("mousedown", this._handleMouseDown);
    this.canvas.removeEventListener("mouseup", this._handleMouseUp);
    this.canvas.parentNode.removeChild(this.canvas);
  }
}

;// ./src/browser/speakers.js
// AudioWorklet processor code, inlined as a string so it can be loaded via
// Blob URL without bundler-specific imports (e.g. ?raw). This avoids
// requiring webpack/Vite to import the module source.
//
// The processor receives stereo samples from the main thread via MessagePort
// and buffers them in a circular Float32Array for playback in process().
const workletCode = `
class NESAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Circular buffer sized to hold ~170ms of audio at 48kHz (8192 samples).
    this.capacity = 8192;
    this.bufferL = new Float32Array(this.capacity);
    this.bufferR = new Float32Array(this.capacity);
    this.readPos = 0;
    this.writePos = 0;
    this.count = 0;

    this.port.onmessage = (e) => {
      if (e.data.type === "samples") {
        const left = e.data.left;
        const right = e.data.right;
        const len = left.length;

        // If adding these samples would overflow, drop oldest to make room
        if (this.count + len > this.capacity) {
          const drop = this.count + len - this.capacity;
          this.readPos = (this.readPos + drop) % this.capacity;
          this.count -= drop;
        }

        for (let i = 0; i < len; i++) {
          this.bufferL[this.writePos] = left[i];
          this.bufferR[this.writePos] = right[i];
          this.writePos = (this.writePos + 1) % this.capacity;
        }
        this.count += len;
      }
    };
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length < 2) return true;

    const outL = output[0];
    const outR = output[1];
    const size = outL.length;

    if (this.count < size) {
      for (let i = 0; i < this.count; i++) {
        outL[i] = this.bufferL[this.readPos];
        outR[i] = this.bufferR[this.readPos];
        this.readPos = (this.readPos + 1) % this.capacity;
      }
      for (let i = this.count; i < size; i++) {
        outL[i] = 0;
        outR[i] = 0;
      }
      this.count = 0;
      this.port.postMessage({ type: "underrun" });
    } else {
      for (let i = 0; i < size; i++) {
        outL[i] = this.bufferL[this.readPos];
        outR[i] = this.bufferR[this.readPos];
        this.readPos = (this.readPos + 1) % this.capacity;
      }
      this.count -= size;
    }

    return true;
  }
}

registerProcessor("nes-audio-processor", NESAudioProcessor);
`;

// How many samples to batch before posting to the worklet. Posting every
// single sample individually would be too much MessagePort overhead.
// 128 matches the AudioWorklet render quantum size.
const BATCH_SIZE = 128;

class Speakers {
  constructor({ onBufferUnderrun }) {
    this.onBufferUnderrun = onBufferUnderrun;
    this.audioCtx = null;
    this.node = null;
    this.batchL = new Float32Array(BATCH_SIZE);
    this.batchR = new Float32Array(BATCH_SIZE);
    this.batchPos = 0;
  }

  getSampleRate() {
    if (this.audioCtx) {
      return this.audioCtx.sampleRate;
    }
    return 44100;
  }

  // start() is async because audioWorklet.addModule() returns a promise.
  // Callers may fire-and-forget — the node will be null until the worklet
  // loads, and writeSample() silently drops samples during that brief window.
  async start() {
    if (!window.AudioContext) {
      return;
    }
    this.audioCtx = new window.AudioContext();

    const blob = new Blob([workletCode], { type: "application/javascript" });
    const workletUrl = URL.createObjectURL(blob);
    await this.audioCtx.audioWorklet.addModule(workletUrl);
    URL.revokeObjectURL(workletUrl);

    this.node = new AudioWorkletNode(this.audioCtx, "nes-audio-processor", {
      outputChannelCount: [2],
    });

    this.node.port.onmessage = (e) => {
      if (e.data.type === "underrun" && this.onBufferUnderrun) {
        this.onBufferUnderrun();
      }
    };

    this.node.connect(this.audioCtx.destination);

    // Chrome and other browsers require a user gesture before AudioContext can
    // start. If suspended, resume on the first user interaction.
    // See https://github.com/bfirsh/jsnes/issues/368
    if (this.audioCtx.state === "suspended") {
      this._resumeOnInteraction = () => {
        if (this.audioCtx) {
          this.audioCtx.resume();
        }
        this._removeResumeListeners();
      };
      document.addEventListener("keydown", this._resumeOnInteraction);
      document.addEventListener("mousedown", this._resumeOnInteraction);
      document.addEventListener("touchstart", this._resumeOnInteraction);
    }
  }

  _removeResumeListeners() {
    if (this._resumeOnInteraction) {
      document.removeEventListener("keydown", this._resumeOnInteraction);
      document.removeEventListener("mousedown", this._resumeOnInteraction);
      document.removeEventListener("touchstart", this._resumeOnInteraction);
      this._resumeOnInteraction = null;
    }
  }

  stop() {
    this._removeResumeListeners();
    if (this.node) {
      this.node.disconnect(this.audioCtx.destination);
      this.node = null;
    }
    if (this.audioCtx) {
      this.audioCtx.close().catch((e) => console.error(e));
      this.audioCtx = null;
    }
    this.batchPos = 0;
  }

  writeSample = (left, right) => {
    if (!this.node) return;

    this.batchL[this.batchPos] = left;
    this.batchR[this.batchPos] = right;
    this.batchPos++;

    if (this.batchPos >= BATCH_SIZE) {
      this.node.port.postMessage({
        type: "samples",
        left: this.batchL.slice(),
        right: this.batchR.slice(),
      });
      this.batchPos = 0;
    }
  };

  // Flush any remaining batched samples to the worklet. Called after each
  // frame to ensure partial batches are sent promptly.
  flush() {
    if (this.batchPos > 0 && this.node) {
      this.node.port.postMessage({
        type: "samples",
        left: this.batchL.slice(0, this.batchPos),
        right: this.batchR.slice(0, this.batchPos),
      });
      this.batchPos = 0;
    }
  }
}

;// ./src/browser/frame-timer.js
// Debug logging, enabled via localStorage.jsnes_debug = 1
let debugEnabled = false;
try {
  debugEnabled = !!localStorage.getItem("jsnes_debug");
} catch {
  // localStorage not available
}

const FPS = 60.098;

class FrameTimer {
  constructor(props) {
    // Run at 60 FPS
    this.onGenerateFrame = props.onGenerateFrame;
    // Run on animation frame
    this.onWriteFrame = props.onWriteFrame;
    this.onAnimationFrame = this.onAnimationFrame.bind(this);
    this.running = true;
    this.interval = 1e3 / FPS;
    this.lastFrameTime = false;
  }

  start() {
    this.running = true;
    this.requestAnimationFrame();
  }

  stop() {
    this.running = false;
    if (this._requestID) window.cancelAnimationFrame(this._requestID);
    this.lastFrameTime = false;
  }

  requestAnimationFrame() {
    this._requestID = window.requestAnimationFrame(this.onAnimationFrame);
  }

  generateFrame() {
    this.onGenerateFrame();
    this.lastFrameTime += this.interval;
  }

  onAnimationFrame = (time) => {
    this.requestAnimationFrame();
    // how many ms after 60fps frame time
    let excess = time % this.interval;

    // newFrameTime is the current time aligned to 60fps intervals.
    // i.e. 16.6, 33.3, etc ...
    let newFrameTime = time - excess;

    // first frame, do nothing
    if (!this.lastFrameTime) {
      this.lastFrameTime = newFrameTime;
      return;
    }

    let numFrames = Math.round(
      (newFrameTime - this.lastFrameTime) / this.interval,
    );

    // This can happen a lot on a 144Hz display
    if (numFrames === 0) {
      return;
    }

    // update display on first frame only
    this.generateFrame();
    this.onWriteFrame();

    // we generate additional frames evenly before the next
    // onAnimationFrame call.
    // additional frames are generated but not displayed
    // until next frame draw
    let timeToNextFrame = this.interval - excess;
    for (let i = 1; i < numFrames; i++) {
      setTimeout(
        () => {
          this.generateFrame();
        },
        (i * timeToNextFrame) / numFrames,
      );
    }
    if (numFrames > 1 && debugEnabled) {
      console.log("SKIP", numFrames - 1, this.lastFrameTime);
    }
  };
}

;// ./src/browser/keyboard.js


// Mapping keyboard code to [controller, button]
const KEYS = {
  88: [1, controller.BUTTON_A, "X"], // X
  89: [1, controller.BUTTON_B, "Y"], // Y (Central European keyboard)
  90: [1, controller.BUTTON_B, "Z"], // Z
  17: [1, controller.BUTTON_SELECT, "Right Ctrl"], // Right Ctrl
  13: [1, controller.BUTTON_START, "Enter"], // Enter
  38: [1, controller.BUTTON_UP, "Up"], // Up
  40: [1, controller.BUTTON_DOWN, "Down"], // Down
  37: [1, controller.BUTTON_LEFT, "Left"], // Left
  39: [1, controller.BUTTON_RIGHT, "Right"], // Right
  83: [1, controller.BUTTON_TURBO_A, "S"], // S
  65: [1, controller.BUTTON_TURBO_B, "A"], // A
  103: [2, controller.BUTTON_A, "Num-7"], // Num-7
  105: [2, controller.BUTTON_B, "Num-9"], // Num-9
  99: [2, controller.BUTTON_SELECT, "Num-3"], // Num-3
  97: [2, controller.BUTTON_START, "Num-1"], // Num-1
  104: [2, controller.BUTTON_UP, "Num-8"], // Num-8
  98: [2, controller.BUTTON_DOWN, "Num-2"], // Num-2
  100: [2, controller.BUTTON_LEFT, "Num-4"], // Num-4
  102: [2, controller.BUTTON_RIGHT, "Num-6"], // Num-6
};

class KeyboardController {
  constructor(options) {
    this.onButtonDown = options.onButtonDown;
    this.onButtonUp = options.onButtonUp;
  }

  loadKeys = () => {
    var keys;
    try {
      keys = localStorage.getItem("keys");
      if (keys) {
        keys = JSON.parse(keys);
      }
    } catch (e) {
      console.warn("Failed to get keys from localStorage.", e);
    }

    this.keys = keys || KEYS;
  };

  setKeys = (newKeys) => {
    try {
      localStorage.setItem("keys", JSON.stringify(newKeys));
      this.keys = newKeys;
    } catch (e) {
      console.warn("Failed to set keys in localStorage.", e);
    }
  };

  handleKeyDown = (e) => {
    var key = this.keys[e.keyCode];
    if (key) {
      this.onButtonDown(key[0], key[1]);
      e.preventDefault();
    }
  };

  handleKeyUp = (e) => {
    var key = this.keys[e.keyCode];
    if (key) {
      this.onButtonUp(key[0], key[1]);
      e.preventDefault();
    }
  };

  handleKeyPress = (e) => {
    if (this.keys[e.keyCode]) {
      e.preventDefault();
    }
  };
}

;// ./src/browser/gamepad.js
class GamepadController {
  constructor(options) {
    this.onButtonDown = options.onButtonDown;
    this.onButtonUp = options.onButtonUp;
    this.gamepadState = [];
    this.buttonCallback = null;
  }

  disableIfGamepadEnabled = (callback) => {
    var self = this;
    return (playerId, buttonId) => {
      if (!self.gamepadConfig) {
        return callback(playerId, buttonId);
      }

      var playerGamepadId = self.gamepadConfig.playerGamepadId;
      if (!playerGamepadId || !playerGamepadId[playerId - 1]) {
        // allow callback only if player is not associated to any gamepad
        return callback(playerId, buttonId);
      }
    };
  };

  _getPlayerNumberFromGamepad = (gamepad) => {
    if (this.gamepadConfig.playerGamepadId[0] === gamepad.id) {
      return 1;
    }

    if (this.gamepadConfig.playerGamepadId[1] === gamepad.id) {
      return 2;
    }

    return 1;
  };

  poll = () => {
    const gamepads = navigator.getGamepads
      ? navigator.getGamepads()
      : navigator.webkitGetGamepads();

    const usedPlayers = [];

    for (let gamepadIndex = 0; gamepadIndex < gamepads.length; gamepadIndex++) {
      const gamepad = gamepads[gamepadIndex];
      const previousGamepad = this.gamepadState[gamepadIndex];

      if (!gamepad) {
        continue;
      }

      if (!previousGamepad) {
        this.gamepadState[gamepadIndex] = gamepad;
        continue;
      }

      const buttons = gamepad.buttons;
      const previousButtons = previousGamepad.buttons;

      if (this.buttonCallback) {
        for (let code = 0; code < gamepad.axes.length; code++) {
          const axis = gamepad.axes[code];
          const previousAxis = previousGamepad.axes[code];

          if (axis === -1 && previousAxis !== -1) {
            this.buttonCallback({
              gamepadId: gamepad.id,
              type: "axis",
              code: code,
              value: axis,
            });
          }

          if (axis === 1 && previousAxis !== 1) {
            this.buttonCallback({
              gamepadId: gamepad.id,
              type: "axis",
              code: code,
              value: axis,
            });
          }
        }

        for (let code = 0; code < buttons.length; code++) {
          const button = buttons[code];
          const previousButton = previousButtons[code];
          if (button.pressed && !previousButton.pressed) {
            this.buttonCallback({
              gamepadId: gamepad.id,
              type: "button",
              code: code,
            });
          }
        }
      } else if (this.gamepadConfig) {
        let playerNumber = this._getPlayerNumberFromGamepad(gamepad);
        if (usedPlayers.length < 2) {
          if (usedPlayers.indexOf(playerNumber) !== -1) {
            playerNumber++;
            if (playerNumber > 2) playerNumber = 1;
          }
          usedPlayers.push(playerNumber);

          if (this.gamepadConfig.configs[gamepad.id]) {
            const configButtons =
              this.gamepadConfig.configs[gamepad.id].buttons;

            for (let i = 0; i < configButtons.length; i++) {
              const configButton = configButtons[i];
              if (configButton.type === "button") {
                const code = configButton.code;
                const button = buttons[code];
                const previousButton = previousButtons[code];

                if (button.pressed && !previousButton.pressed) {
                  this.onButtonDown(playerNumber, configButton.buttonId);
                } else if (!button.pressed && previousButton.pressed) {
                  this.onButtonUp(playerNumber, configButton.buttonId);
                }
              } else if (configButton.type === "axis") {
                const code = configButton.code;
                const axis = gamepad.axes[code];
                const previousAxis = previousGamepad.axes[code];

                if (
                  axis === configButton.value &&
                  previousAxis !== configButton.value
                ) {
                  this.onButtonDown(playerNumber, configButton.buttonId);
                }

                if (
                  axis !== configButton.value &&
                  previousAxis === configButton.value
                ) {
                  this.onButtonUp(playerNumber, configButton.buttonId);
                }
              }
            }
          }
        }
      }

      this.gamepadState[gamepadIndex] = {
        buttons: buttons.map((b) => {
          return { pressed: b.pressed };
        }),
        axes: gamepad.axes.slice(0),
      };
    }
  };

  promptButton = (f) => {
    if (!f) {
      this.buttonCallback = f;
    } else {
      this.buttonCallback = (buttonInfo) => {
        this.buttonCallback = null;
        f(buttonInfo);
      };
    }
  };

  loadGamepadConfig = () => {
    var gamepadConfig;
    try {
      gamepadConfig = localStorage.getItem("gamepadConfig");
      if (gamepadConfig) {
        gamepadConfig = JSON.parse(gamepadConfig);
      }
    } catch (e) {
      console.warn("Failed to get gamepadConfig from localStorage.", e);
    }

    this.gamepadConfig = gamepadConfig;
  };

  setGamepadConfig = (gamepadConfig) => {
    try {
      localStorage.setItem("gamepadConfig", JSON.stringify(gamepadConfig));
      this.gamepadConfig = gamepadConfig;
    } catch (e) {
      console.warn("Failed to set gamepadConfig in localStorage.", e);
    }
  };

  startPolling = () => {
    if (!(navigator.getGamepads || navigator.webkitGetGamepads)) {
      return { stop: () => {} };
    }

    let stopped = false;
    const loop = () => {
      if (stopped) return;

      this.poll();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);

    return {
      stop: () => {
        stopped = true;
      },
    };
  };
}

;// ./src/browser/index.js







// Debug logging, enabled via localStorage.jsnes_debug = 1
let browser_debugEnabled = false;
try {
  browser_debugEnabled = !!localStorage.getItem("jsnes_debug");
} catch {
  // localStorage not available
}
function debug(...args) {
  if (browser_debugEnabled) console.log(...args);
}

/**
 * Browser-based NES emulator that handles canvas rendering, audio output,
 * keyboard/gamepad input, and frame timing.
 *
 * Usage:
 *   const browser = new jsnes.Browser({
 *     container: document.getElementById("nes"),
 *     romData: romData,
 *     onError: (e) => console.error(e),
 *   });
 *
 * If romData is omitted, call browser.loadROM(data) then browser.start().
 */
class Browser {
  constructor(options = {}) {
    this._options = options;

    // Create screen (creates <canvas> inside container)
    this._screen = new Screen(options.container, {
      onMouseDown: (x, y) => {
        this.nes.zapperMove(x, y);
        this.nes.zapperFireDown();
      },
      onMouseUp: () => {
        this.nes.zapperFireUp();
      },
    });
    this._screen.fitInParent();

    // Create speakers
    this._speakers = new Speakers({
      onBufferUnderrun: () => {
        // Generate extra frames so audio remains consistent. This happens for
        // a variety of reasons:
        // - Frame rate is not quite 60fps, so sometimes buffer empties
        // - Page is not visible, so requestAnimationFrame doesn't get fired.
        //   In this case emulator still runs at full speed, but timing is
        //   done by audio instead of requestAnimationFrame.
        // - System can't run emulator at full speed. In this case it'll stop
        //    firing requestAnimationFrame.
        debug("Buffer underrun, running extra frames to catch up");

        // The NES produces ~800 samples per frame at 48kHz. Run two frames
        // to ensure the worklet buffer is refilled.
        this._frameTimer.generateFrame();
        this._frameTimer.generateFrame();
      },
    });

    // Create NES
    this.nes = new nes({
      onFrame: this._screen.setBuffer,
      onStatusUpdate: debug,
      onAudioSample: this._speakers.writeSample,
      onBatteryRamWrite: options.onBatteryRamWrite || (() => {}),
      sampleRate: this._speakers.getSampleRate(),
    });

    // Create frame timer
    this._frameTimer = new FrameTimer({
      onGenerateFrame: () => {
        try {
          this.nes.frame();
          this._speakers.flush();
        } catch (e) {
          this.stop();
          if (this._options.onError) {
            this._options.onError(e);
          }
        }
      },
      onWriteFrame: this._screen.writeBuffer,
    });

    // Set up gamepad and keyboard
    this.gamepad = new GamepadController({
      onButtonDown: this.nes.buttonDown,
      onButtonUp: this.nes.buttonUp,
    });
    this.gamepad.loadGamepadConfig();
    this._gamepadPolling = this.gamepad.startPolling();

    this.keyboard = new KeyboardController({
      onButtonDown: this.gamepad.disableIfGamepadEnabled(this.nes.buttonDown),
      onButtonUp: this.gamepad.disableIfGamepadEnabled(this.nes.buttonUp),
    });
    this.keyboard.loadKeys();

    // Bind keyboard events
    document.addEventListener("keydown", this.keyboard.handleKeyDown);
    document.addEventListener("keyup", this.keyboard.handleKeyUp);
    document.addEventListener("keypress", this.keyboard.handleKeyPress);

    // Load ROM and start if provided
    if (options.romData) {
      this.nes.loadROM(options.romData);
      this.start();
    }
  }

  start() {
    this._frameTimer.start();
    this._speakers.start();
    this._fpsInterval = setInterval(() => {
      debug(`FPS: ${this.nes.getFPS()}`);
    }, 1000);
  }

  stop() {
    this._frameTimer.stop();
    this._speakers.stop();
    clearInterval(this._fpsInterval);
  }

  loadROM(data) {
    this.stop();
    this.nes.loadROM(data);
    this.start();
  }

  /**
   * Fill parent element with screen. Call if parent element changes size.
   */
  fitInParent() {
    this._screen.fitInParent();
  }

  screenshot() {
    return this._screen.screenshot();
  }

  /**
   * Clean up all resources: stop emulation, remove event listeners, remove canvas.
   */
  destroy() {
    this.stop();
    document.removeEventListener("keydown", this.keyboard.handleKeyDown);
    document.removeEventListener("keyup", this.keyboard.handleKeyUp);
    document.removeEventListener("keypress", this.keyboard.handleKeyPress);
    this._gamepadPolling.stop();
    this._screen.destroy();
  }

  /**
   * Load ROM data from a URL via XHR.
   */
  static loadROMFromURL(url, callback) {
    var req = new XMLHttpRequest();
    req.open("GET", url);
    req.overrideMimeType("text/plain; charset=x-user-defined");
    req.onerror = () =>
      callback(new Error(`Error loading ${url}: ${req.statusText}`));
    req.onload = function () {
      if (this.status === 200) {
        callback(null, this.responseText);
      } else if (this.status === 0) {
        // Aborted, ignore
      } else {
        req.onerror();
      }
    };
    req.send();
    return req;
  }
}

;// ./src/index.js







/******/ 	return __webpack_exports__;
/******/ })()
;
});


;/* src/rosters.js */
/* Generated by tools/import-rosters.cjs from pinned factual roster data.
   Source attribution and verification: AUTHENTICITY.md. */
(function (root) {
  "use strict";
  const data = {"teams":[{"id":0,"name":"Bills","city":"Buffalo","abbreviation":"BUF","conference":"AFC","division":"East"},{"id":1,"name":"Colts","city":"Indianapolis","abbreviation":"IND","conference":"AFC","division":"East"},{"id":2,"name":"Dolphins","city":"Miami","abbreviation":"MIA","conference":"AFC","division":"East"},{"id":3,"name":"Patriots","city":"New England","abbreviation":"NEP","conference":"AFC","division":"East"},{"id":4,"name":"Jets","city":"New York","abbreviation":"NYJ","conference":"AFC","division":"East"},{"id":5,"name":"Bengals","city":"Cincinnati","abbreviation":"CIN","conference":"AFC","division":"Central"},{"id":6,"name":"Browns","city":"Cleveland","abbreviation":"CLE","conference":"AFC","division":"Central"},{"id":7,"name":"Oilers","city":"Houston","abbreviation":"HOU","conference":"AFC","division":"Central"},{"id":8,"name":"Steelers","city":"Pittsburgh","abbreviation":"PIT","conference":"AFC","division":"Central"},{"id":9,"name":"Broncos","city":"Denver","abbreviation":"DEN","conference":"AFC","division":"West"},{"id":10,"name":"Chiefs","city":"Kansas City","abbreviation":"KAN","conference":"AFC","division":"West"},{"id":11,"name":"Raiders","city":"Los Angeles","abbreviation":"RAI","conference":"AFC","division":"West"},{"id":12,"name":"Chargers","city":"San Diego","abbreviation":"LAC","conference":"AFC","division":"West"},{"id":13,"name":"Seahawks","city":"Seattle","abbreviation":"SEA","conference":"AFC","division":"West"},{"id":14,"name":"Redskins","city":"Washington","abbreviation":"WAS","conference":"NFC","division":"East"},{"id":15,"name":"Giants","city":"New York","abbreviation":"NYG","conference":"NFC","division":"East"},{"id":16,"name":"Eagles","city":"Philadelphia","abbreviation":"PHI","conference":"NFC","division":"East"},{"id":17,"name":"Cardinals","city":"Phoenix","abbreviation":"PHO","conference":"NFC","division":"East"},{"id":18,"name":"Cowboys","city":"Dallas","abbreviation":"DAL","conference":"NFC","division":"East"},{"id":19,"name":"Bears","city":"Chicago","abbreviation":"CHI","conference":"NFC","division":"Central"},{"id":20,"name":"Lions","city":"Detroit","abbreviation":"DET","conference":"NFC","division":"Central"},{"id":21,"name":"Packers","city":"Green Bay","abbreviation":"GB","conference":"NFC","division":"Central"},{"id":22,"name":"Vikings","city":"Minnesota","abbreviation":"MIN","conference":"NFC","division":"Central"},{"id":23,"name":"Buccaneers","city":"Tampa Bay","abbreviation":"TB","conference":"NFC","division":"Central"},{"id":24,"name":"49ers","city":"San Francisco","abbreviation":"SF","conference":"NFC","division":"West"},{"id":25,"name":"Rams","city":"Los Angeles","abbreviation":"LAR","conference":"NFC","division":"West"},{"id":26,"name":"Saints","city":"New Orleans","abbreviation":"NO","conference":"NFC","division":"West"},{"id":27,"name":"Falcons","city":"Atlanta","abbreviation":"ATL","conference":"NFC","division":"West"}],"players":[{"id":0,"team_id":0,"name":"Qb Bills","position":"QB","position_detail":"QB1","jersey":0,"face":82,"name_rom_offset":1754,"ability_rom_offset":12304,"team_idx":0,"pos_idx":0,"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":56,"pass_control":81,"accuracy_of_passing":81,"avoid_pass_block":81,"jerseyNumber":0,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":56,"pass_control":81,"accuracy_of_passing":81,"avoid_pass_block":81}},{"id":1,"team_id":0,"name":"Frank Reich","position":"QB","position_detail":"QB2","jersey":20,"face":34,"name_rom_offset":1762,"ability_rom_offset":12309,"team_idx":0,"pos_idx":1,"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":31,"pass_control":44,"accuracy_of_passing":25,"avoid_pass_block":50,"jerseyNumber":14,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":31,"pass_control":44,"accuracy_of_passing":25,"avoid_pass_block":50}},{"id":2,"team_id":0,"name":"Thurman Thomas","position":"RB","position_detail":"RB1","jersey":52,"face":131,"name_rom_offset":1773,"ability_rom_offset":12314,"team_idx":0,"pos_idx":2,"rushing_power":69,"running_speed":38,"maximum_speed":63,"hitting_power":25,"ball_control":75,"receptions":50,"jerseyNumber":34,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":63,"hitting_power":25,"ball_control":75,"receptions":50}},{"id":3,"team_id":0,"name":"Jamie Mueller","position":"RB","position_detail":"RB2","jersey":65,"face":81,"name_rom_offset":1787,"ability_rom_offset":12318,"team_idx":0,"pos_idx":3,"rushing_power":69,"running_speed":44,"maximum_speed":25,"hitting_power":88,"ball_control":50,"receptions":25,"jerseyNumber":41,"ratings":{"rushing_power":69,"running_speed":44,"maximum_speed":25,"hitting_power":88,"ball_control":50,"receptions":25}},{"id":4,"team_id":0,"name":"Kenneth Davis","position":"RB","position_detail":"RB3","jersey":35,"face":165,"name_rom_offset":1800,"ability_rom_offset":12322,"team_idx":0,"pos_idx":4,"rushing_power":69,"running_speed":38,"maximum_speed":25,"hitting_power":19,"ball_control":50,"receptions":31,"jerseyNumber":23,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":25,"hitting_power":19,"ball_control":50,"receptions":31}},{"id":5,"team_id":0,"name":"Don Smith","position":"RB","position_detail":"RB4","jersey":48,"face":139,"name_rom_offset":1813,"ability_rom_offset":12326,"team_idx":0,"pos_idx":5,"rushing_power":69,"running_speed":38,"maximum_speed":25,"hitting_power":19,"ball_control":50,"receptions":31,"jerseyNumber":30,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":25,"hitting_power":19,"ball_control":50,"receptions":31}},{"id":6,"team_id":0,"name":"James Lofton","position":"WR","position_detail":"WR1","jersey":128,"face":129,"name_rom_offset":1822,"ability_rom_offset":12330,"team_idx":0,"pos_idx":6,"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":13,"ball_control":50,"receptions":56,"jerseyNumber":80,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":13,"ball_control":50,"receptions":56}},{"id":7,"team_id":0,"name":"Andre Reed","position":"WR","position_detail":"WR2","jersey":131,"face":182,"name_rom_offset":1834,"ability_rom_offset":12334,"team_idx":0,"pos_idx":7,"rushing_power":69,"running_speed":25,"maximum_speed":56,"hitting_power":13,"ball_control":56,"receptions":69,"jerseyNumber":83,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":56,"hitting_power":13,"ball_control":56,"receptions":69}},{"id":8,"team_id":0,"name":"Don Beebe","position":"WR","position_detail":"WR3","jersey":130,"face":64,"name_rom_offset":1844,"ability_rom_offset":12338,"team_idx":0,"pos_idx":8,"rushing_power":69,"running_speed":25,"maximum_speed":44,"hitting_power":13,"ball_control":50,"receptions":44,"jerseyNumber":82,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":44,"hitting_power":13,"ball_control":50,"receptions":44}},{"id":9,"team_id":0,"name":"Al Edwards","position":"WR","position_detail":"WR4","jersey":133,"face":154,"name_rom_offset":1853,"ability_rom_offset":12342,"team_idx":0,"pos_idx":9,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":13,"ball_control":50,"receptions":44,"jerseyNumber":85,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":13,"ball_control":50,"receptions":44}},{"id":10,"team_id":0,"name":"Keith Mckeller","position":"TE","position_detail":"TE1","jersey":132,"face":183,"name_rom_offset":1863,"ability_rom_offset":12346,"team_idx":0,"pos_idx":10,"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":50,"ball_control":50,"receptions":50,"jerseyNumber":84,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":50,"ball_control":50,"receptions":50}},{"id":11,"team_id":0,"name":"Pete Metzelaars","position":"TE","position_detail":"TE2","jersey":136,"face":80,"name_rom_offset":1877,"ability_rom_offset":12350,"team_idx":0,"pos_idx":11,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":44,"ball_control":50,"receptions":31,"jerseyNumber":88,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":44,"ball_control":50,"receptions":31}},{"id":12,"team_id":0,"name":"Kent Hull","position":"OL","position_detail":"C","jersey":103,"face":30,"name_rom_offset":1892,"ability_rom_offset":12354,"team_idx":0,"pos_idx":12,"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":69,"jerseyNumber":67,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":69}},{"id":13,"team_id":0,"name":"Jim Ritcher","position":"OL","position_detail":"LG","jersey":81,"face":7,"name_rom_offset":1901,"ability_rom_offset":12357,"team_idx":0,"pos_idx":13,"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":56,"jerseyNumber":51,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":56}},{"id":14,"team_id":0,"name":"John Davis","position":"OL","position_detail":"RG","jersey":101,"face":36,"name_rom_offset":1912,"ability_rom_offset":12360,"team_idx":0,"pos_idx":14,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":63,"jerseyNumber":65,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":63}},{"id":15,"team_id":0,"name":"Will Wolford","position":"OL","position_detail":"LT","jersey":105,"face":72,"name_rom_offset":1922,"ability_rom_offset":12363,"team_idx":0,"pos_idx":15,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":50,"jerseyNumber":69,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":50}},{"id":16,"team_id":0,"name":"Howard Ballard","position":"OL","position_detail":"RT","jersey":117,"face":136,"name_rom_offset":1934,"ability_rom_offset":12366,"team_idx":0,"pos_idx":16,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":63,"jerseyNumber":75,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":63}},{"id":17,"team_id":0,"name":"Bruce Smith","position":"DL","position_detail":"RE","jersey":120,"face":136,"name_rom_offset":1948,"ability_rom_offset":12369,"team_idx":0,"pos_idx":17,"rushing_power":56,"running_speed":44,"maximum_speed":69,"hitting_power":75,"pass_interceptions":25,"quickness":81,"jerseyNumber":78,"ratings":{"rushing_power":56,"running_speed":44,"maximum_speed":69,"hitting_power":75,"pass_interceptions":25,"quickness":81}},{"id":18,"team_id":0,"name":"Jeff Wright","position":"DL","position_detail":"NT","jersey":145,"face":11,"name_rom_offset":1959,"ability_rom_offset":12373,"team_idx":0,"pos_idx":18,"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":50,"pass_interceptions":19,"quickness":19,"jerseyNumber":91,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":50,"pass_interceptions":19,"quickness":19}},{"id":19,"team_id":0,"name":"Leon Seals","position":"DL","position_detail":"LE","jersey":150,"face":172,"name_rom_offset":1970,"ability_rom_offset":12377,"team_idx":0,"pos_idx":19,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":44,"pass_interceptions":31,"quickness":50,"jerseyNumber":96,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":44,"pass_interceptions":31,"quickness":50}},{"id":20,"team_id":0,"name":"Darryl Talley","position":"LB","position_detail":"ROLB","jersey":86,"face":173,"name_rom_offset":1980,"ability_rom_offset":12381,"team_idx":0,"pos_idx":20,"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":38,"pass_interceptions":44,"quickness":63,"jerseyNumber":56,"ratings":{"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":38,"pass_interceptions":44,"quickness":63}},{"id":21,"team_id":0,"name":"Ray Bentley","position":"LB","position_detail":"RILB","jersey":80,"face":48,"name_rom_offset":1993,"ability_rom_offset":12385,"team_idx":0,"pos_idx":21,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":31,"quickness":56,"jerseyNumber":50,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":31,"quickness":56}},{"id":22,"team_id":0,"name":"Shane Conlan","position":"LB","position_detail":"LILB","jersey":88,"face":47,"name_rom_offset":2004,"ability_rom_offset":12389,"team_idx":0,"pos_idx":22,"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":56,"pass_interceptions":19,"quickness":69,"jerseyNumber":58,"ratings":{"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":56,"pass_interceptions":19,"quickness":69}},{"id":23,"team_id":0,"name":"C. Bennett","position":"LB","position_detail":"LOLB","jersey":151,"face":130,"name_rom_offset":2016,"ability_rom_offset":12393,"team_idx":0,"pos_idx":23,"rushing_power":50,"running_speed":38,"maximum_speed":63,"hitting_power":63,"pass_interceptions":19,"quickness":69,"jerseyNumber":97,"ratings":{"rushing_power":50,"running_speed":38,"maximum_speed":63,"hitting_power":63,"pass_interceptions":19,"quickness":69}},{"id":24,"team_id":0,"name":"Nate Odomes","position":"DB","position_detail":"RCB","jersey":55,"face":195,"name_rom_offset":2026,"ability_rom_offset":12397,"team_idx":0,"pos_idx":24,"rushing_power":44,"running_speed":38,"maximum_speed":56,"hitting_power":38,"pass_interceptions":38,"quickness":56,"jerseyNumber":37,"ratings":{"rushing_power":44,"running_speed":38,"maximum_speed":56,"hitting_power":38,"pass_interceptions":38,"quickness":56}},{"id":25,"team_id":0,"name":"Kirby Jackson","position":"DB","position_detail":"LCB","jersey":71,"face":137,"name_rom_offset":2037,"ability_rom_offset":12401,"team_idx":0,"pos_idx":25,"rushing_power":31,"running_speed":25,"maximum_speed":44,"hitting_power":38,"pass_interceptions":50,"quickness":50,"jerseyNumber":47,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":44,"hitting_power":38,"pass_interceptions":50,"quickness":50}},{"id":26,"team_id":0,"name":"Mark Kelso","position":"DB","position_detail":"FS","jersey":56,"face":38,"name_rom_offset":2050,"ability_rom_offset":12405,"team_idx":0,"pos_idx":26,"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":38,"pass_interceptions":44,"quickness":44,"jerseyNumber":38,"ratings":{"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":38,"pass_interceptions":44,"quickness":44}},{"id":27,"team_id":0,"name":"Leonard Smith","position":"DB","position_detail":"SS","jersey":70,"face":132,"name_rom_offset":2060,"ability_rom_offset":12409,"team_idx":0,"pos_idx":27,"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":44,"pass_interceptions":44,"quickness":50,"jerseyNumber":46,"ratings":{"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":44,"pass_interceptions":44,"quickness":50}},{"id":28,"team_id":0,"name":"Scott Norwood","position":"K","position_detail":"K","jersey":17,"face":41,"name_rom_offset":2073,"ability_rom_offset":12413,"team_idx":0,"pos_idx":28,"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":44,"avoid_kick_block":44,"jerseyNumber":11,"ratings":{"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":44,"avoid_kick_block":44}},{"id":29,"team_id":0,"name":"Rick Tuten","position":"P","position_detail":"P","jersey":16,"face":32,"name_rom_offset":2086,"ability_rom_offset":12417,"team_idx":0,"pos_idx":29,"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":19,"avoid_kick_block":63,"jerseyNumber":10,"ratings":{"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":19,"avoid_kick_block":63}},{"id":30,"team_id":1,"name":"Jeff George","position":"QB","position_detail":"QB1","jersey":17,"face":4,"name_rom_offset":2096,"ability_rom_offset":12421,"team_idx":1,"pos_idx":0,"rushing_power":69,"running_speed":25,"maximum_speed":6,"hitting_power":13,"passing_speed":50,"pass_control":31,"accuracy_of_passing":38,"avoid_pass_block":25,"jerseyNumber":11,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":6,"hitting_power":13,"passing_speed":50,"pass_control":31,"accuracy_of_passing":38,"avoid_pass_block":25}},{"id":31,"team_id":1,"name":"Jack Trudeau","position":"QB","position_detail":"QB2","jersey":16,"face":3,"name_rom_offset":2107,"ability_rom_offset":12426,"team_idx":1,"pos_idx":1,"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":31,"pass_control":38,"accuracy_of_passing":31,"avoid_pass_block":50,"jerseyNumber":10,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":31,"pass_control":38,"accuracy_of_passing":31,"avoid_pass_block":50}},{"id":32,"team_id":1,"name":"Ivy Joe Hunter","position":"RB","position_detail":"RB1","jersey":69,"face":192,"name_rom_offset":2119,"ability_rom_offset":12431,"team_idx":1,"pos_idx":2,"rushing_power":69,"running_speed":38,"maximum_speed":31,"hitting_power":50,"ball_control":50,"receptions":25,"jerseyNumber":45,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":31,"hitting_power":50,"ball_control":50,"receptions":25}},{"id":33,"team_id":1,"name":"Albert Bentley","position":"RB","position_detail":"RB2","jersey":32,"face":150,"name_rom_offset":2133,"ability_rom_offset":12435,"team_idx":1,"pos_idx":3,"rushing_power":69,"running_speed":38,"maximum_speed":44,"hitting_power":31,"ball_control":50,"receptions":63,"jerseyNumber":20,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":44,"hitting_power":31,"ball_control":50,"receptions":63}},{"id":34,"team_id":1,"name":"Anthony Johnson","position":"RB","position_detail":"RB3","jersey":35,"face":146,"name_rom_offset":2147,"ability_rom_offset":12439,"team_idx":1,"pos_idx":4,"rushing_power":69,"running_speed":38,"maximum_speed":31,"hitting_power":25,"ball_control":50,"receptions":25,"jerseyNumber":23,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":31,"hitting_power":25,"ball_control":50,"receptions":25}},{"id":35,"team_id":1,"name":"Ken Clark","position":"RB","position_detail":"RB4","jersey":50,"face":198,"name_rom_offset":2162,"ability_rom_offset":12443,"team_idx":1,"pos_idx":5,"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":25,"ball_control":50,"receptions":25,"jerseyNumber":32,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":25,"ball_control":50,"receptions":25}},{"id":36,"team_id":1,"name":"Bill Brooks","position":"WR","position_detail":"WR1","jersey":128,"face":171,"name_rom_offset":2171,"ability_rom_offset":12447,"team_idx":1,"pos_idx":6,"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":13,"ball_control":50,"receptions":69,"jerseyNumber":80,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":13,"ball_control":50,"receptions":69}},{"id":37,"team_id":1,"name":"Jessie Hester","position":"WR","position_detail":"WR2","jersey":132,"face":165,"name_rom_offset":2182,"ability_rom_offset":12451,"team_idx":1,"pos_idx":7,"rushing_power":69,"running_speed":44,"maximum_speed":38,"hitting_power":13,"ball_control":50,"receptions":63,"jerseyNumber":84,"ratings":{"rushing_power":69,"running_speed":44,"maximum_speed":38,"hitting_power":13,"ball_control":50,"receptions":63}},{"id":38,"team_id":1,"name":"Clarence Verdin","position":"WR","position_detail":"WR3","jersey":131,"face":159,"name_rom_offset":2195,"ability_rom_offset":12455,"team_idx":1,"pos_idx":8,"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":13,"ball_control":50,"receptions":44,"jerseyNumber":83,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":13,"ball_control":50,"receptions":44}},{"id":39,"team_id":1,"name":"Stanley Morgan","position":"WR","position_detail":"WR4","jersey":136,"face":189,"name_rom_offset":2210,"ability_rom_offset":12459,"team_idx":1,"pos_idx":9,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":44,"jerseyNumber":88,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":44}},{"id":40,"team_id":1,"name":"Pat Beach","position":"TE","position_detail":"TE1","jersey":129,"face":14,"name_rom_offset":2224,"ability_rom_offset":12463,"team_idx":1,"pos_idx":10,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":50,"ball_control":50,"receptions":38,"jerseyNumber":81,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":50,"ball_control":50,"receptions":38}},{"id":41,"team_id":1,"name":"Orson Mobley","position":"TE","position_detail":"TE2","jersey":137,"face":174,"name_rom_offset":2233,"ability_rom_offset":12467,"team_idx":1,"pos_idx":11,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":50,"ball_control":50,"receptions":31,"jerseyNumber":89,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":50,"ball_control":50,"receptions":31}},{"id":42,"team_id":1,"name":"Ray Donaldson","position":"OL","position_detail":"C","jersey":83,"face":175,"name_rom_offset":2245,"ability_rom_offset":12471,"team_idx":1,"pos_idx":12,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":50,"jerseyNumber":53,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":50}},{"id":43,"team_id":1,"name":"Randy Dixon","position":"OL","position_detail":"LG","jersey":105,"face":149,"name_rom_offset":2258,"ability_rom_offset":12474,"team_idx":1,"pos_idx":13,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":50,"jerseyNumber":69,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":50}},{"id":44,"team_id":1,"name":"Brian Baldinger","position":"OL","position_detail":"RG","jersey":98,"face":39,"name_rom_offset":2269,"ability_rom_offset":12477,"team_idx":1,"pos_idx":14,"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":38,"jerseyNumber":62,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":38}},{"id":45,"team_id":1,"name":"Zefross Moss","position":"OL","position_detail":"LT","jersey":115,"face":193,"name_rom_offset":2284,"ability_rom_offset":12480,"team_idx":1,"pos_idx":15,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":63,"jerseyNumber":73,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":63}},{"id":46,"team_id":1,"name":"Kevin Call","position":"OL","position_detail":"RT","jersey":113,"face":7,"name_rom_offset":2296,"ability_rom_offset":12483,"team_idx":1,"pos_idx":16,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":56,"jerseyNumber":71,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":56}},{"id":47,"team_id":1,"name":"Jon Hand","position":"DL","position_detail":"RE","jersey":120,"face":184,"name_rom_offset":2306,"ability_rom_offset":12486,"team_idx":1,"pos_idx":17,"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":56,"pass_interceptions":19,"quickness":25,"jerseyNumber":78,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":56,"pass_interceptions":19,"quickness":25}},{"id":48,"team_id":1,"name":"Harvey Armstrong","position":"DL","position_detail":"NT","jersey":121,"face":138,"name_rom_offset":2314,"ability_rom_offset":12490,"team_idx":1,"pos_idx":18,"rushing_power":31,"running_speed":25,"maximum_speed":25,"hitting_power":50,"pass_interceptions":19,"quickness":19,"jerseyNumber":79,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":25,"hitting_power":50,"pass_interceptions":19,"quickness":19}},{"id":49,"team_id":1,"name":"Sam Clancy","position":"DL","position_detail":"LE","jersey":118,"face":135,"name_rom_offset":2330,"ability_rom_offset":12494,"team_idx":1,"pos_idx":19,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":50,"pass_interceptions":19,"quickness":63,"jerseyNumber":76,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":50,"pass_interceptions":19,"quickness":63}},{"id":50,"team_id":1,"name":"Duane Bickett","position":"LB","position_detail":"ROLB","jersey":80,"face":38,"name_rom_offset":2340,"ability_rom_offset":12498,"team_idx":1,"pos_idx":20,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":50,"pass_interceptions":25,"quickness":38,"jerseyNumber":50,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":50,"pass_interceptions":25,"quickness":38}},{"id":51,"team_id":1,"name":"Fredd Young","position":"LB","position_detail":"RILB","jersey":86,"face":49,"name_rom_offset":2353,"ability_rom_offset":12502,"team_idx":1,"pos_idx":21,"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":31,"pass_interceptions":25,"quickness":31,"jerseyNumber":56,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":31,"pass_interceptions":25,"quickness":31}},{"id":52,"team_id":1,"name":"Jeff Herrod","position":"LB","position_detail":"LILB","jersey":84,"face":136,"name_rom_offset":2364,"ability_rom_offset":12506,"team_idx":1,"pos_idx":22,"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":44,"pass_interceptions":25,"quickness":50,"jerseyNumber":54,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":44,"pass_interceptions":25,"quickness":50}},{"id":53,"team_id":1,"name":"Chip Banks","position":"LB","position_detail":"LOLB","jersey":81,"face":132,"name_rom_offset":2375,"ability_rom_offset":12510,"team_idx":1,"pos_idx":23,"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":44,"pass_interceptions":25,"quickness":38,"jerseyNumber":51,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":44,"pass_interceptions":25,"quickness":38}},{"id":54,"team_id":1,"name":"Eugene Daniel","position":"DB","position_detail":"RCB","jersey":56,"face":153,"name_rom_offset":2385,"ability_rom_offset":12514,"team_idx":1,"pos_idx":24,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":31,"quickness":31,"jerseyNumber":38,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":31,"quickness":31}},{"id":55,"team_id":1,"name":"Chris Goode","position":"DB","position_detail":"LCB","jersey":55,"face":133,"name_rom_offset":2398,"ability_rom_offset":12518,"team_idx":1,"pos_idx":25,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":31,"quickness":31,"jerseyNumber":37,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":31,"quickness":31}},{"id":56,"team_id":1,"name":"Mike Prior","position":"DB","position_detail":"FS","jersey":57,"face":50,"name_rom_offset":2409,"ability_rom_offset":12522,"team_idx":1,"pos_idx":26,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":44,"pass_interceptions":44,"quickness":44,"jerseyNumber":39,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":44,"pass_interceptions":44,"quickness":44}},{"id":57,"team_id":1,"name":"Keith Taylor","position":"DB","position_detail":"SS","jersey":39,"face":161,"name_rom_offset":2419,"ability_rom_offset":12526,"team_idx":1,"pos_idx":27,"rushing_power":31,"running_speed":25,"maximum_speed":44,"hitting_power":38,"pass_interceptions":38,"quickness":44,"jerseyNumber":27,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":44,"hitting_power":38,"pass_interceptions":38,"quickness":44}},{"id":58,"team_id":1,"name":"Dean Biasucci","position":"K","position_detail":"K","jersey":4,"face":16,"name_rom_offset":2431,"ability_rom_offset":12530,"team_idx":1,"pos_idx":28,"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":38,"avoid_kick_block":38,"jerseyNumber":4,"ratings":{"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":38,"avoid_kick_block":38}},{"id":59,"team_id":1,"name":"Rohn Stark","position":"P","position_detail":"P","jersey":3,"face":64,"name_rom_offset":2444,"ability_rom_offset":12534,"team_idx":1,"pos_idx":29,"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":75,"avoid_kick_block":56,"jerseyNumber":3,"ratings":{"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":75,"avoid_kick_block":56}},{"id":60,"team_id":2,"name":"Dan Marino","position":"QB","position_detail":"QB1","jersey":19,"face":6,"name_rom_offset":2454,"ability_rom_offset":12538,"team_idx":2,"pos_idx":0,"rushing_power":69,"running_speed":25,"maximum_speed":6,"hitting_power":13,"passing_speed":81,"pass_control":69,"accuracy_of_passing":63,"avoid_pass_block":69,"jerseyNumber":13,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":6,"hitting_power":13,"passing_speed":81,"pass_control":69,"accuracy_of_passing":63,"avoid_pass_block":69}},{"id":61,"team_id":2,"name":"Scott Mitchell","position":"QB","position_detail":"QB2","jersey":25,"face":64,"name_rom_offset":2464,"ability_rom_offset":12543,"team_idx":2,"pos_idx":1,"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":44,"pass_control":44,"accuracy_of_passing":25,"avoid_pass_block":50,"jerseyNumber":19,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":44,"pass_control":44,"accuracy_of_passing":25,"avoid_pass_block":50}},{"id":62,"team_id":2,"name":"Sammie Smith","position":"RB","position_detail":"RB1","jersey":51,"face":141,"name_rom_offset":2478,"ability_rom_offset":12548,"team_idx":2,"pos_idx":2,"rushing_power":69,"running_speed":44,"maximum_speed":38,"hitting_power":63,"ball_control":50,"receptions":25,"jerseyNumber":33,"ratings":{"rushing_power":69,"running_speed":44,"maximum_speed":38,"hitting_power":63,"ball_control":50,"receptions":25}},{"id":63,"team_id":2,"name":"Tony Paige","position":"RB","position_detail":"RB2","jersey":73,"face":180,"name_rom_offset":2490,"ability_rom_offset":12552,"team_idx":2,"pos_idx":3,"rushing_power":69,"running_speed":44,"maximum_speed":31,"hitting_power":88,"ball_control":50,"receptions":44,"jerseyNumber":49,"ratings":{"rushing_power":69,"running_speed":44,"maximum_speed":31,"hitting_power":88,"ball_control":50,"receptions":44}},{"id":64,"team_id":2,"name":"Marc Logan","position":"RB","position_detail":"RB3","jersey":32,"face":133,"name_rom_offset":2500,"ability_rom_offset":12556,"team_idx":2,"pos_idx":4,"rushing_power":69,"running_speed":44,"maximum_speed":38,"hitting_power":44,"ball_control":50,"receptions":25,"jerseyNumber":20,"ratings":{"rushing_power":69,"running_speed":44,"maximum_speed":38,"hitting_power":44,"ball_control":50,"receptions":25}},{"id":65,"team_id":2,"name":"Troy Stradford","position":"RB","position_detail":"RB4","jersey":35,"face":142,"name_rom_offset":2510,"ability_rom_offset":12560,"team_idx":2,"pos_idx":5,"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":25,"ball_control":50,"receptions":38,"jerseyNumber":23,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":25,"ball_control":50,"receptions":38}},{"id":66,"team_id":2,"name":"Mark Clayton","position":"WR","position_detail":"WR1","jersey":131,"face":208,"name_rom_offset":2524,"ability_rom_offset":12564,"team_idx":2,"pos_idx":6,"rushing_power":69,"running_speed":31,"maximum_speed":44,"hitting_power":13,"ball_control":50,"receptions":69,"jerseyNumber":83,"ratings":{"rushing_power":69,"running_speed":31,"maximum_speed":44,"hitting_power":13,"ball_control":50,"receptions":69}},{"id":67,"team_id":2,"name":"Mark Duper","position":"WR","position_detail":"WR2","jersey":133,"face":132,"name_rom_offset":2536,"ability_rom_offset":12568,"team_idx":2,"pos_idx":7,"rushing_power":69,"running_speed":38,"maximum_speed":50,"hitting_power":13,"ball_control":50,"receptions":63,"jerseyNumber":85,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":50,"hitting_power":13,"ball_control":50,"receptions":63}},{"id":68,"team_id":2,"name":"Fred Banks","position":"WR","position_detail":"WR3","jersey":134,"face":179,"name_rom_offset":2546,"ability_rom_offset":12572,"team_idx":2,"pos_idx":8,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":13,"ball_control":50,"receptions":44,"jerseyNumber":86,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":13,"ball_control":50,"receptions":44}},{"id":69,"team_id":2,"name":"Tony Martin","position":"WR","position_detail":"WR4","jersey":137,"face":162,"name_rom_offset":2556,"ability_rom_offset":12576,"team_idx":2,"pos_idx":9,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":50,"jerseyNumber":89,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":50}},{"id":70,"team_id":2,"name":"Ferrell Edmunds","position":"TE","position_detail":"TE1","jersey":128,"face":192,"name_rom_offset":2567,"ability_rom_offset":12580,"team_idx":2,"pos_idx":10,"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":56,"ball_control":50,"receptions":50,"jerseyNumber":80,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":56,"ball_control":50,"receptions":50}},{"id":71,"team_id":2,"name":"Jim Jensen","position":"TE","position_detail":"TE2","jersey":17,"face":5,"name_rom_offset":2582,"ability_rom_offset":12584,"team_idx":2,"pos_idx":11,"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":44,"ball_control":50,"receptions":69,"jerseyNumber":11,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":44,"ball_control":50,"receptions":69}},{"id":72,"team_id":2,"name":"Jeff Uhlenhake","position":"OL","position_detail":"C","jersey":99,"face":42,"name_rom_offset":2592,"ability_rom_offset":12588,"team_idx":2,"pos_idx":12,"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":69,"jerseyNumber":63,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":69}},{"id":73,"team_id":2,"name":"Keith Sims","position":"OL","position_detail":"LG","jersey":105,"face":191,"name_rom_offset":2606,"ability_rom_offset":12591,"team_idx":2,"pos_idx":13,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":69,"jerseyNumber":69,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":69}},{"id":74,"team_id":2,"name":"Harry Galbreath","position":"OL","position_detail":"RG","jersey":98,"face":147,"name_rom_offset":2616,"ability_rom_offset":12594,"team_idx":2,"pos_idx":14,"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":63,"jerseyNumber":62,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":63}},{"id":75,"team_id":2,"name":"Richmond Webb","position":"OL","position_detail":"LT","jersey":120,"face":156,"name_rom_offset":2631,"ability_rom_offset":12597,"team_idx":2,"pos_idx":15,"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":75,"jerseyNumber":78,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":75}},{"id":76,"team_id":2,"name":"Mark Dennis","position":"OL","position_detail":"RT","jersey":116,"face":30,"name_rom_offset":2644,"ability_rom_offset":12600,"team_idx":2,"pos_idx":16,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":56,"jerseyNumber":74,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":56}},{"id":77,"team_id":2,"name":"Jeff Cross","position":"DL","position_detail":"RE","jersey":145,"face":130,"name_rom_offset":2655,"ability_rom_offset":12603,"team_idx":2,"pos_idx":17,"rushing_power":50,"running_speed":38,"maximum_speed":56,"hitting_power":50,"pass_interceptions":19,"quickness":69,"jerseyNumber":91,"ratings":{"rushing_power":50,"running_speed":38,"maximum_speed":56,"hitting_power":50,"pass_interceptions":19,"quickness":69}},{"id":78,"team_id":2,"name":"Shawn Lee","position":"DL","position_detail":"NT","jersey":152,"face":194,"name_rom_offset":2665,"ability_rom_offset":12607,"team_idx":2,"pos_idx":18,"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":56,"pass_interceptions":19,"quickness":19,"jerseyNumber":98,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":56,"pass_interceptions":19,"quickness":19}},{"id":79,"team_id":2,"name":"Karl Wilson","position":"DL","position_detail":"LE","jersey":119,"face":198,"name_rom_offset":2674,"ability_rom_offset":12611,"team_idx":2,"pos_idx":19,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":50,"pass_interceptions":19,"quickness":50,"jerseyNumber":77,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":50,"pass_interceptions":19,"quickness":50}},{"id":80,"team_id":2,"name":"Hugh Green","position":"LB","position_detail":"ROLB","jersey":85,"face":178,"name_rom_offset":2685,"ability_rom_offset":12615,"team_idx":2,"pos_idx":20,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":44,"pass_interceptions":25,"quickness":50,"jerseyNumber":55,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":44,"pass_interceptions":25,"quickness":50}},{"id":81,"team_id":2,"name":"Cliff Odom","position":"LB","position_detail":"RILB","jersey":147,"face":177,"name_rom_offset":2695,"ability_rom_offset":12619,"team_idx":2,"pos_idx":21,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":44,"pass_interceptions":25,"quickness":44,"jerseyNumber":93,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":44,"pass_interceptions":25,"quickness":44}},{"id":82,"team_id":2,"name":"John Offerdahl","position":"LB","position_detail":"LILB","jersey":86,"face":50,"name_rom_offset":2705,"ability_rom_offset":12623,"team_idx":2,"pos_idx":22,"rushing_power":50,"running_speed":38,"maximum_speed":56,"hitting_power":44,"pass_interceptions":31,"quickness":50,"jerseyNumber":56,"ratings":{"rushing_power":50,"running_speed":38,"maximum_speed":56,"hitting_power":44,"pass_interceptions":31,"quickness":50}},{"id":83,"team_id":2,"name":"David Griggs","position":"LB","position_detail":"LOLB","jersey":146,"face":163,"name_rom_offset":2719,"ability_rom_offset":12627,"team_idx":2,"pos_idx":23,"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":44,"pass_interceptions":25,"quickness":50,"jerseyNumber":92,"ratings":{"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":44,"pass_interceptions":25,"quickness":50}},{"id":84,"team_id":2,"name":"J.b. Brown","position":"DB","position_detail":"RCB","jersey":55,"face":164,"name_rom_offset":2731,"ability_rom_offset":12631,"team_idx":2,"pos_idx":24,"rushing_power":31,"running_speed":25,"maximum_speed":44,"hitting_power":50,"pass_interceptions":44,"quickness":50,"jerseyNumber":37,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":44,"hitting_power":50,"pass_interceptions":44,"quickness":50}},{"id":85,"team_id":2,"name":"Tim Mckyer","position":"DB","position_detail":"LCB","jersey":34,"face":136,"name_rom_offset":2741,"ability_rom_offset":12635,"team_idx":2,"pos_idx":25,"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":44,"pass_interceptions":50,"quickness":50,"jerseyNumber":22,"ratings":{"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":44,"pass_interceptions":50,"quickness":50}},{"id":86,"team_id":2,"name":"Louis Oliver","position":"DB","position_detail":"FS","jersey":37,"face":146,"name_rom_offset":2751,"ability_rom_offset":12639,"team_idx":2,"pos_idx":26,"rushing_power":44,"running_speed":38,"maximum_speed":56,"hitting_power":56,"pass_interceptions":56,"quickness":56,"jerseyNumber":25,"ratings":{"rushing_power":44,"running_speed":38,"maximum_speed":56,"hitting_power":56,"pass_interceptions":56,"quickness":56}},{"id":87,"team_id":2,"name":"Jarvis Williams","position":"DB","position_detail":"SS","jersey":38,"face":150,"name_rom_offset":2763,"ability_rom_offset":12643,"team_idx":2,"pos_idx":27,"rushing_power":44,"running_speed":38,"maximum_speed":56,"hitting_power":56,"pass_interceptions":56,"quickness":56,"jerseyNumber":26,"ratings":{"rushing_power":44,"running_speed":38,"maximum_speed":56,"hitting_power":56,"pass_interceptions":56,"quickness":56}},{"id":88,"team_id":2,"name":"Pete Stoyanovich","position":"K","position_detail":"K","jersey":16,"face":24,"name_rom_offset":2778,"ability_rom_offset":12647,"team_idx":2,"pos_idx":28,"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":69,"avoid_kick_block":75,"jerseyNumber":10,"ratings":{"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":69,"avoid_kick_block":75}},{"id":89,"team_id":2,"name":"Reggie Roby","position":"P","position_detail":"P","jersey":4,"face":182,"name_rom_offset":2794,"ability_rom_offset":12651,"team_idx":2,"pos_idx":29,"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":75,"avoid_kick_block":38,"jerseyNumber":4,"ratings":{"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":75,"avoid_kick_block":38}},{"id":90,"team_id":3,"name":"Steve Grogan","position":"QB","position_detail":"QB1","jersey":20,"face":7,"name_rom_offset":2805,"ability_rom_offset":12655,"team_idx":3,"pos_idx":0,"rushing_power":69,"running_speed":25,"maximum_speed":6,"hitting_power":13,"passing_speed":19,"pass_control":25,"accuracy_of_passing":31,"avoid_pass_block":44,"jerseyNumber":14,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":6,"hitting_power":13,"passing_speed":19,"pass_control":25,"accuracy_of_passing":31,"avoid_pass_block":44}},{"id":91,"team_id":3,"name":"Marc Wilson","position":"QB","position_detail":"QB2","jersey":21,"face":51,"name_rom_offset":2817,"ability_rom_offset":12660,"team_idx":3,"pos_idx":1,"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":38,"pass_control":44,"accuracy_of_passing":25,"avoid_pass_block":38,"jerseyNumber":15,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":38,"pass_control":44,"accuracy_of_passing":25,"avoid_pass_block":38}},{"id":92,"team_id":3,"name":"Marvin Allen","position":"RB","position_detail":"RB1","jersey":57,"face":146,"name_rom_offset":2828,"ability_rom_offset":12665,"team_idx":3,"pos_idx":2,"rushing_power":69,"running_speed":44,"maximum_speed":25,"hitting_power":38,"ball_control":50,"receptions":25,"jerseyNumber":39,"ratings":{"rushing_power":69,"running_speed":44,"maximum_speed":25,"hitting_power":38,"ball_control":50,"receptions":25}},{"id":93,"team_id":3,"name":"John Stephens","position":"RB","position_detail":"RB2","jersey":68,"face":132,"name_rom_offset":2840,"ability_rom_offset":12669,"team_idx":3,"pos_idx":3,"rushing_power":69,"running_speed":44,"maximum_speed":31,"hitting_power":50,"ball_control":50,"receptions":31,"jerseyNumber":44,"ratings":{"rushing_power":69,"running_speed":44,"maximum_speed":31,"hitting_power":50,"ball_control":50,"receptions":31}},{"id":94,"team_id":3,"name":"George Adams","position":"RB","position_detail":"RB3","jersey":51,"face":195,"name_rom_offset":2853,"ability_rom_offset":12673,"team_idx":3,"pos_idx":4,"rushing_power":69,"running_speed":38,"maximum_speed":31,"hitting_power":31,"ball_control":50,"receptions":25,"jerseyNumber":33,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":31,"hitting_power":31,"ball_control":50,"receptions":25}},{"id":95,"team_id":3,"name":"Mosi Tatupu","position":"RB","position_detail":"RB4","jersey":48,"face":71,"name_rom_offset":2865,"ability_rom_offset":12677,"team_idx":3,"pos_idx":5,"rushing_power":69,"running_speed":38,"maximum_speed":31,"hitting_power":31,"ball_control":50,"receptions":25,"jerseyNumber":30,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":31,"hitting_power":31,"ball_control":50,"receptions":25}},{"id":96,"team_id":3,"name":"Irving Fryar","position":"WR","position_detail":"WR1","jersey":128,"face":170,"name_rom_offset":2876,"ability_rom_offset":12681,"team_idx":3,"pos_idx":6,"rushing_power":69,"running_speed":31,"maximum_speed":31,"hitting_power":13,"ball_control":50,"receptions":63,"jerseyNumber":80,"ratings":{"rushing_power":69,"running_speed":31,"maximum_speed":31,"hitting_power":13,"ball_control":50,"receptions":63}},{"id":97,"team_id":3,"name":"Hart Lee Dykes","position":"WR","position_detail":"WR2","jersey":136,"face":145,"name_rom_offset":2888,"ability_rom_offset":12685,"team_idx":3,"pos_idx":7,"rushing_power":69,"running_speed":31,"maximum_speed":31,"hitting_power":13,"ball_control":50,"receptions":50,"jerseyNumber":88,"ratings":{"rushing_power":69,"running_speed":31,"maximum_speed":31,"hitting_power":13,"ball_control":50,"receptions":50}},{"id":98,"team_id":3,"name":"Greg Mcmurty","position":"WR","position_detail":"WR3","jersey":25,"face":142,"name_rom_offset":2902,"ability_rom_offset":12689,"team_idx":3,"pos_idx":8,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":13,"ball_control":50,"receptions":50,"jerseyNumber":19,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":13,"ball_control":50,"receptions":50}},{"id":99,"team_id":3,"name":"Sammy Martin","position":"WR","position_detail":"WR4","jersey":130,"face":54,"name_rom_offset":2914,"ability_rom_offset":12693,"team_idx":3,"pos_idx":9,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":44,"jerseyNumber":82,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":44}},{"id":100,"team_id":3,"name":"Marv Cook","position":"TE","position_detail":"TE1","jersey":70,"face":33,"name_rom_offset":2926,"ability_rom_offset":12697,"team_idx":3,"pos_idx":10,"rushing_power":69,"running_speed":25,"maximum_speed":44,"hitting_power":56,"ball_control":50,"receptions":63,"jerseyNumber":46,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":44,"hitting_power":56,"ball_control":50,"receptions":63}},{"id":101,"team_id":3,"name":"Eric Sievers","position":"TE","position_detail":"TE2","jersey":133,"face":66,"name_rom_offset":2935,"ability_rom_offset":12701,"team_idx":3,"pos_idx":11,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":31,"ball_control":50,"receptions":50,"jerseyNumber":85,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":31,"ball_control":50,"receptions":50}},{"id":102,"team_id":3,"name":"Paul Fairchild","position":"OL","position_detail":"C","jersey":102,"face":67,"name_rom_offset":2947,"ability_rom_offset":12705,"team_idx":3,"pos_idx":12,"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":38,"jerseyNumber":66,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":38}},{"id":103,"team_id":3,"name":"Chris Gambol","position":"OL","position_detail":"LG","jersey":116,"face":68,"name_rom_offset":2961,"ability_rom_offset":12708,"team_idx":3,"pos_idx":13,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":50,"jerseyNumber":74,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":50}},{"id":104,"team_id":3,"name":"Damian Johnson","position":"OL","position_detail":"RG","jersey":104,"face":175,"name_rom_offset":2973,"ability_rom_offset":12711,"team_idx":3,"pos_idx":14,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":44,"jerseyNumber":68,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":44}},{"id":105,"team_id":3,"name":"Bruce Armstrong","position":"OL","position_detail":"LT","jersey":120,"face":128,"name_rom_offset":2987,"ability_rom_offset":12714,"team_idx":3,"pos_idx":15,"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":69,"jerseyNumber":78,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":69}},{"id":106,"team_id":3,"name":"Danny Villa","position":"OL","position_detail":"RT","jersey":117,"face":50,"name_rom_offset":3002,"ability_rom_offset":12717,"team_idx":3,"pos_idx":16,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":50,"jerseyNumber":75,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":50}},{"id":107,"team_id":3,"name":"Garin Veris","position":"DL","position_detail":"RE","jersey":96,"face":161,"name_rom_offset":3013,"ability_rom_offset":12720,"team_idx":3,"pos_idx":17,"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":50,"pass_interceptions":19,"quickness":50,"jerseyNumber":60,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":50,"pass_interceptions":19,"quickness":50}},{"id":108,"team_id":3,"name":"Tim Goad","position":"DL","position_detail":"NT","jersey":114,"face":52,"name_rom_offset":3024,"ability_rom_offset":12724,"team_idx":3,"pos_idx":18,"rushing_power":31,"running_speed":25,"maximum_speed":25,"hitting_power":50,"pass_interceptions":19,"quickness":19,"jerseyNumber":72,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":25,"hitting_power":50,"pass_interceptions":19,"quickness":19}},{"id":109,"team_id":3,"name":"Ray Agnew","position":"DL","position_detail":"LE","jersey":146,"face":146,"name_rom_offset":3032,"ability_rom_offset":12728,"team_idx":3,"pos_idx":19,"rushing_power":50,"running_speed":38,"maximum_speed":56,"hitting_power":56,"pass_interceptions":31,"quickness":56,"jerseyNumber":92,"ratings":{"rushing_power":50,"running_speed":38,"maximum_speed":56,"hitting_power":56,"pass_interceptions":31,"quickness":56}},{"id":110,"team_id":3,"name":"Andre Tippett","position":"LB","position_detail":"ROLB","jersey":86,"face":133,"name_rom_offset":3041,"ability_rom_offset":12732,"team_idx":3,"pos_idx":20,"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":56,"pass_interceptions":31,"quickness":44,"jerseyNumber":56,"ratings":{"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":56,"pass_interceptions":31,"quickness":44}},{"id":111,"team_id":3,"name":"Ed Reynolds","position":"LB","position_detail":"RILB","jersey":149,"face":194,"name_rom_offset":3054,"ability_rom_offset":12736,"team_idx":3,"pos_idx":21,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":19,"quickness":31,"jerseyNumber":95,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":19,"quickness":31}},{"id":112,"team_id":3,"name":"Richard Harvey","position":"LB","position_detail":"LILB","jersey":88,"face":164,"name_rom_offset":3065,"ability_rom_offset":12740,"team_idx":3,"pos_idx":22,"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":38,"pass_interceptions":19,"quickness":31,"jerseyNumber":58,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":38,"pass_interceptions":19,"quickness":31}},{"id":113,"team_id":3,"name":"Chris Singleton","position":"LB","position_detail":"LOLB","jersey":85,"face":134,"name_rom_offset":3079,"ability_rom_offset":12744,"team_idx":3,"pos_idx":23,"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":38,"pass_interceptions":19,"quickness":38,"jerseyNumber":55,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":38,"pass_interceptions":19,"quickness":38}},{"id":114,"team_id":3,"name":"Maurice Hurst","position":"DB","position_detail":"RCB","jersey":55,"face":136,"name_rom_offset":3094,"ability_rom_offset":12748,"team_idx":3,"pos_idx":24,"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":44,"pass_interceptions":50,"quickness":38,"jerseyNumber":37,"ratings":{"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":44,"pass_interceptions":50,"quickness":38}},{"id":115,"team_id":3,"name":"Ronnie Lippett","position":"DB","position_detail":"LCB","jersey":66,"face":163,"name_rom_offset":3107,"ability_rom_offset":12752,"team_idx":3,"pos_idx":25,"rushing_power":44,"running_speed":38,"maximum_speed":56,"hitting_power":50,"pass_interceptions":63,"quickness":56,"jerseyNumber":42,"ratings":{"rushing_power":44,"running_speed":38,"maximum_speed":56,"hitting_power":50,"pass_interceptions":63,"quickness":56}},{"id":116,"team_id":3,"name":"Fred Marion","position":"DB","position_detail":"FS","jersey":49,"face":153,"name_rom_offset":3121,"ability_rom_offset":12756,"team_idx":3,"pos_idx":26,"rushing_power":31,"running_speed":25,"maximum_speed":44,"hitting_power":50,"pass_interceptions":50,"quickness":44,"jerseyNumber":31,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":44,"hitting_power":50,"pass_interceptions":50,"quickness":44}},{"id":117,"team_id":3,"name":"Rod Mcswain","position":"DB","position_detail":"SS","jersey":35,"face":141,"name_rom_offset":3132,"ability_rom_offset":12760,"team_idx":3,"pos_idx":27,"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":56,"pass_interceptions":31,"quickness":31,"jerseyNumber":23,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":56,"pass_interceptions":31,"quickness":31}},{"id":118,"team_id":3,"name":"Jason Staurovsky","position":"K","position_detail":"K","jersey":4,"face":46,"name_rom_offset":3143,"ability_rom_offset":12764,"team_idx":3,"pos_idx":28,"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":63,"avoid_kick_block":44,"jerseyNumber":4,"ratings":{"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":63,"avoid_kick_block":44}},{"id":119,"team_id":3,"name":"Brian Hansen","position":"P","position_detail":"P","jersey":16,"face":21,"name_rom_offset":3159,"ability_rom_offset":12768,"team_idx":3,"pos_idx":29,"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":31,"avoid_kick_block":31,"jerseyNumber":10,"ratings":{"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":31,"avoid_kick_block":31}},{"id":120,"team_id":4,"name":"Ken O.Brien","position":"QB","position_detail":"QB1","jersey":7,"face":12,"name_rom_offset":3171,"ability_rom_offset":12772,"team_idx":4,"pos_idx":0,"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":56,"pass_control":50,"accuracy_of_passing":44,"avoid_pass_block":38,"jerseyNumber":7,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":56,"pass_control":50,"accuracy_of_passing":44,"avoid_pass_block":38}},{"id":121,"team_id":4,"name":"Tony Eason","position":"QB","position_detail":"QB2","jersey":17,"face":9,"name_rom_offset":3182,"ability_rom_offset":12777,"team_idx":4,"pos_idx":1,"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":44,"pass_control":44,"accuracy_of_passing":25,"avoid_pass_block":31,"jerseyNumber":11,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":44,"pass_control":44,"accuracy_of_passing":25,"avoid_pass_block":31}},{"id":122,"team_id":4,"name":"Blair Thomas","position":"RB","position_detail":"RB1","jersey":50,"face":170,"name_rom_offset":3192,"ability_rom_offset":12782,"team_idx":4,"pos_idx":2,"rushing_power":69,"running_speed":38,"maximum_speed":44,"hitting_power":25,"ball_control":50,"receptions":31,"jerseyNumber":32,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":44,"hitting_power":25,"ball_control":50,"receptions":31}},{"id":123,"team_id":4,"name":"Freeman Mcneil","position":"RB","position_detail":"RB2","jersey":36,"face":171,"name_rom_offset":3204,"ability_rom_offset":12786,"team_idx":4,"pos_idx":3,"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":19,"ball_control":50,"receptions":25,"jerseyNumber":24,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":19,"ball_control":50,"receptions":25}},{"id":124,"team_id":4,"name":"Brad Baxter","position":"RB","position_detail":"RB3","jersey":48,"face":144,"name_rom_offset":3218,"ability_rom_offset":12790,"team_idx":4,"pos_idx":4,"rushing_power":69,"running_speed":44,"maximum_speed":31,"hitting_power":31,"ball_control":50,"receptions":25,"jerseyNumber":30,"ratings":{"rushing_power":69,"running_speed":44,"maximum_speed":31,"hitting_power":31,"ball_control":50,"receptions":25}},{"id":125,"team_id":4,"name":"Johnny Hector","position":"RB","position_detail":"RB4","jersey":52,"face":139,"name_rom_offset":3229,"ability_rom_offset":12794,"team_idx":4,"pos_idx":5,"rushing_power":69,"running_speed":38,"maximum_speed":44,"hitting_power":19,"ball_control":50,"receptions":25,"jerseyNumber":34,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":44,"hitting_power":19,"ball_control":50,"receptions":25}},{"id":126,"team_id":4,"name":"Al Toon","position":"WR","position_detail":"WR1","jersey":136,"face":134,"name_rom_offset":3242,"ability_rom_offset":12798,"team_idx":4,"pos_idx":6,"rushing_power":69,"running_speed":31,"maximum_speed":44,"hitting_power":13,"ball_control":50,"receptions":69,"jerseyNumber":88,"ratings":{"rushing_power":69,"running_speed":31,"maximum_speed":44,"hitting_power":13,"ball_control":50,"receptions":69}},{"id":127,"team_id":4,"name":"Rob Moore","position":"WR","position_detail":"WR2","jersey":133,"face":141,"name_rom_offset":3249,"ability_rom_offset":12802,"team_idx":4,"pos_idx":7,"rushing_power":69,"running_speed":31,"maximum_speed":31,"hitting_power":13,"ball_control":50,"receptions":50,"jerseyNumber":85,"ratings":{"rushing_power":69,"running_speed":31,"maximum_speed":31,"hitting_power":13,"ball_control":50,"receptions":50}},{"id":128,"team_id":4,"name":"Terance Mathis","position":"WR","position_detail":"WR3","jersey":129,"face":161,"name_rom_offset":3258,"ability_rom_offset":12806,"team_idx":4,"pos_idx":8,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":13,"ball_control":50,"receptions":44,"jerseyNumber":81,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":13,"ball_control":50,"receptions":44}},{"id":129,"team_id":4,"name":"Jojo Townsell","position":"WR","position_detail":"WR4","jersey":131,"face":176,"name_rom_offset":3272,"ability_rom_offset":12810,"team_idx":4,"pos_idx":9,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":13,"ball_control":50,"receptions":44,"jerseyNumber":83,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":13,"ball_control":50,"receptions":44}},{"id":130,"team_id":4,"name":"Mark Boyer","position":"TE","position_detail":"TE1","jersey":128,"face":66,"name_rom_offset":3285,"ability_rom_offset":12814,"team_idx":4,"pos_idx":10,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":56,"ball_control":50,"receptions":50,"jerseyNumber":80,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":56,"ball_control":50,"receptions":50}},{"id":131,"team_id":4,"name":"Doug Wellsandt","position":"TE","position_detail":"TE2","jersey":134,"face":67,"name_rom_offset":3295,"ability_rom_offset":12818,"team_idx":4,"pos_idx":11,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":38,"ball_control":50,"receptions":31,"jerseyNumber":86,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":38,"ball_control":50,"receptions":31}},{"id":132,"team_id":4,"name":"Jim Sweeney","position":"OL","position_detail":"C","jersey":83,"face":29,"name_rom_offset":3309,"ability_rom_offset":12822,"team_idx":4,"pos_idx":12,"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":44,"jerseyNumber":53,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":44}},{"id":133,"team_id":4,"name":"Mike Haight","position":"OL","position_detail":"LG","jersey":121,"face":65,"name_rom_offset":3320,"ability_rom_offset":12825,"team_idx":4,"pos_idx":13,"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":44,"jerseyNumber":79,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":44}},{"id":134,"team_id":4,"name":"Dave Cadigan","position":"OL","position_detail":"RG","jersey":102,"face":61,"name_rom_offset":3331,"ability_rom_offset":12828,"team_idx":4,"pos_idx":14,"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":50,"jerseyNumber":66,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":50}},{"id":135,"team_id":4,"name":"Jeff Criswell","position":"OL","position_detail":"LT","jersey":97,"face":51,"name_rom_offset":3343,"ability_rom_offset":12831,"team_idx":4,"pos_idx":15,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":50,"jerseyNumber":61,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":50}},{"id":136,"team_id":4,"name":"Brett Miller","position":"OL","position_detail":"RT","jersey":114,"face":42,"name_rom_offset":3356,"ability_rom_offset":12834,"team_idx":4,"pos_idx":16,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":50,"jerseyNumber":72,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":50}},{"id":137,"team_id":4,"name":"Jeff Lageman","position":"DL","position_detail":"RE","jersey":86,"face":68,"name_rom_offset":3368,"ability_rom_offset":12837,"team_idx":4,"pos_idx":17,"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":44,"pass_interceptions":19,"quickness":31,"jerseyNumber":56,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":44,"pass_interceptions":19,"quickness":31}},{"id":138,"team_id":4,"name":"Scott Mersereau","position":"DL","position_detail":"NT","jersey":148,"face":72,"name_rom_offset":3380,"ability_rom_offset":12841,"team_idx":4,"pos_idx":18,"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":44,"pass_interceptions":19,"quickness":31,"jerseyNumber":94,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":44,"pass_interceptions":19,"quickness":31}},{"id":139,"team_id":4,"name":"Ron Stallworth","position":"DL","position_detail":"LE","jersey":150,"face":143,"name_rom_offset":3395,"ability_rom_offset":12845,"team_idx":4,"pos_idx":19,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":50,"pass_interceptions":19,"quickness":50,"jerseyNumber":96,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":50,"pass_interceptions":19,"quickness":50}},{"id":140,"team_id":4,"name":"Joe Kelly","position":"LB","position_detail":"ROLB","jersey":88,"face":154,"name_rom_offset":3409,"ability_rom_offset":12849,"team_idx":4,"pos_idx":20,"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":44,"pass_interceptions":19,"quickness":31,"jerseyNumber":58,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":44,"pass_interceptions":19,"quickness":31}},{"id":141,"team_id":4,"name":"Dennis Byrd","position":"LB","position_detail":"RILB","jersey":144,"face":33,"name_rom_offset":3418,"ability_rom_offset":12853,"team_idx":4,"pos_idx":21,"rushing_power":50,"running_speed":38,"maximum_speed":56,"hitting_power":69,"pass_interceptions":25,"quickness":69,"jerseyNumber":90,"ratings":{"rushing_power":50,"running_speed":38,"maximum_speed":56,"hitting_power":69,"pass_interceptions":25,"quickness":69}},{"id":142,"team_id":4,"name":"Kyle Clifton","position":"LB","position_detail":"LILB","jersey":89,"face":16,"name_rom_offset":3429,"ability_rom_offset":12857,"team_idx":4,"pos_idx":22,"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":50,"pass_interceptions":50,"quickness":44,"jerseyNumber":59,"ratings":{"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":50,"pass_interceptions":50,"quickness":44}},{"id":143,"team_id":4,"name":"Joe Mott","position":"LB","position_detail":"LOLB","jersey":81,"face":31,"name_rom_offset":3441,"ability_rom_offset":12861,"team_idx":4,"pos_idx":23,"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":44,"pass_interceptions":19,"quickness":31,"jerseyNumber":51,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":44,"pass_interceptions":19,"quickness":31}},{"id":144,"team_id":4,"name":"James Hasty","position":"DB","position_detail":"RCB","jersey":64,"face":146,"name_rom_offset":3449,"ability_rom_offset":12865,"team_idx":4,"pos_idx":24,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":44,"quickness":31,"jerseyNumber":40,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":44,"quickness":31}},{"id":145,"team_id":4,"name":"Tony Stargell","position":"DB","position_detail":"LCB","jersey":69,"face":196,"name_rom_offset":3460,"ability_rom_offset":12869,"team_idx":4,"pos_idx":25,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":31,"pass_interceptions":44,"quickness":31,"jerseyNumber":45,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":31,"pass_interceptions":44,"quickness":31}},{"id":146,"team_id":4,"name":"Erik Mcmillan","position":"DB","position_detail":"FS","jersey":34,"face":135,"name_rom_offset":3473,"ability_rom_offset":12873,"team_idx":4,"pos_idx":26,"rushing_power":44,"running_speed":38,"maximum_speed":56,"hitting_power":56,"pass_interceptions":63,"quickness":81,"jerseyNumber":22,"ratings":{"rushing_power":44,"running_speed":38,"maximum_speed":56,"hitting_power":56,"pass_interceptions":63,"quickness":81}},{"id":147,"team_id":4,"name":"Brian Washington","position":"DB","position_detail":"SS","jersey":33,"face":142,"name_rom_offset":3486,"ability_rom_offset":12877,"team_idx":4,"pos_idx":27,"rushing_power":31,"running_speed":25,"maximum_speed":44,"hitting_power":38,"pass_interceptions":50,"quickness":38,"jerseyNumber":21,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":44,"hitting_power":38,"pass_interceptions":50,"quickness":38}},{"id":148,"team_id":4,"name":"Pat Leahy","position":"K","position_detail":"K","jersey":5,"face":54,"name_rom_offset":3502,"ability_rom_offset":12881,"team_idx":4,"pos_idx":28,"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":75,"avoid_kick_block":69,"jerseyNumber":5,"ratings":{"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":75,"avoid_kick_block":69}},{"id":149,"team_id":4,"name":"Joe Prokop","position":"P","position_detail":"P","jersey":6,"face":46,"name_rom_offset":3511,"ability_rom_offset":12885,"team_idx":4,"pos_idx":29,"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":69,"avoid_kick_block":75,"jerseyNumber":6,"ratings":{"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":69,"avoid_kick_block":75}},{"id":150,"team_id":5,"name":"Boomer Esiason","position":"QB","position_detail":"QB1","jersey":7,"face":10,"name_rom_offset":3521,"ability_rom_offset":12889,"team_idx":5,"pos_idx":0,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":13,"passing_speed":63,"pass_control":56,"accuracy_of_passing":69,"avoid_pass_block":75,"jerseyNumber":7,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":13,"passing_speed":63,"pass_control":56,"accuracy_of_passing":69,"avoid_pass_block":75}},{"id":151,"team_id":5,"name":"Erik Wilhelm","position":"QB","position_detail":"QB2","jersey":4,"face":52,"name_rom_offset":3535,"ability_rom_offset":12894,"team_idx":5,"pos_idx":1,"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":44,"pass_control":44,"accuracy_of_passing":38,"avoid_pass_block":38,"jerseyNumber":4,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":44,"pass_control":44,"accuracy_of_passing":38,"avoid_pass_block":38}},{"id":152,"team_id":5,"name":"James Brooks","position":"RB","position_detail":"RB1","jersey":33,"face":128,"name_rom_offset":3547,"ability_rom_offset":12899,"team_idx":5,"pos_idx":2,"rushing_power":69,"running_speed":38,"maximum_speed":56,"hitting_power":31,"ball_control":50,"receptions":38,"jerseyNumber":21,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":56,"hitting_power":31,"ball_control":50,"receptions":38}},{"id":153,"team_id":5,"name":"Ickey Woods","position":"RB","position_detail":"RB2","jersey":48,"face":197,"name_rom_offset":3559,"ability_rom_offset":12903,"team_idx":5,"pos_idx":3,"rushing_power":69,"running_speed":44,"maximum_speed":31,"hitting_power":81,"ball_control":50,"receptions":31,"jerseyNumber":30,"ratings":{"rushing_power":69,"running_speed":44,"maximum_speed":31,"hitting_power":81,"ball_control":50,"receptions":31}},{"id":154,"team_id":5,"name":"Harold Green","position":"RB","position_detail":"RB3","jersey":40,"face":163,"name_rom_offset":3570,"ability_rom_offset":12907,"team_idx":5,"pos_idx":4,"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":31,"ball_control":50,"receptions":25,"jerseyNumber":28,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":31,"ball_control":50,"receptions":25}},{"id":155,"team_id":5,"name":"S. Jennings","position":"RB","position_detail":"RB4","jersey":54,"face":171,"name_rom_offset":3582,"ability_rom_offset":12911,"team_idx":5,"pos_idx":5,"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":25,"ball_control":50,"receptions":25,"jerseyNumber":36,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":25,"ball_control":50,"receptions":25}},{"id":156,"team_id":5,"name":"Tim Mcgee","position":"WR","position_detail":"WR1","jersey":133,"face":145,"name_rom_offset":3593,"ability_rom_offset":12915,"team_idx":5,"pos_idx":6,"rushing_power":69,"running_speed":31,"maximum_speed":31,"hitting_power":13,"ball_control":50,"receptions":56,"jerseyNumber":85,"ratings":{"rushing_power":69,"running_speed":31,"maximum_speed":31,"hitting_power":13,"ball_control":50,"receptions":56}},{"id":157,"team_id":5,"name":"Eddie Brown","position":"WR","position_detail":"WR2","jersey":129,"face":193,"name_rom_offset":3602,"ability_rom_offset":12919,"team_idx":5,"pos_idx":7,"rushing_power":69,"running_speed":31,"maximum_speed":38,"hitting_power":13,"ball_control":50,"receptions":56,"jerseyNumber":81,"ratings":{"rushing_power":69,"running_speed":31,"maximum_speed":38,"hitting_power":13,"ball_control":50,"receptions":56}},{"id":158,"team_id":5,"name":"Kendal Smith","position":"WR","position_detail":"WR3","jersey":131,"face":176,"name_rom_offset":3613,"ability_rom_offset":12923,"team_idx":5,"pos_idx":8,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":44,"jerseyNumber":83,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":44}},{"id":159,"team_id":5,"name":"Mike Barber","position":"WR","position_detail":"WR4","jersey":134,"face":18,"name_rom_offset":3625,"ability_rom_offset":12927,"team_idx":5,"pos_idx":9,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":44,"jerseyNumber":86,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":44}},{"id":160,"team_id":5,"name":"Rodney Holman","position":"TE","position_detail":"TE1","jersey":130,"face":201,"name_rom_offset":3636,"ability_rom_offset":12931,"team_idx":5,"pos_idx":10,"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":69,"ball_control":50,"receptions":56,"jerseyNumber":82,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":69,"ball_control":50,"receptions":56}},{"id":161,"team_id":5,"name":"Eric Kattus","position":"TE","position_detail":"TE2","jersey":132,"face":24,"name_rom_offset":3649,"ability_rom_offset":12935,"team_idx":5,"pos_idx":11,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":38,"ball_control":50,"receptions":31,"jerseyNumber":84,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":38,"ball_control":50,"receptions":31}},{"id":162,"team_id":5,"name":"Bruce Kozerski","position":"OL","position_detail":"C","jersey":100,"face":65,"name_rom_offset":3660,"ability_rom_offset":12939,"team_idx":5,"pos_idx":12,"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":56,"jerseyNumber":64,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":56}},{"id":163,"team_id":5,"name":"Bruce Reimers","position":"OL","position_detail":"LG","jersey":117,"face":30,"name_rom_offset":3674,"ability_rom_offset":12942,"team_idx":5,"pos_idx":13,"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":63,"jerseyNumber":75,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":63}},{"id":164,"team_id":5,"name":"Brian Blados","position":"OL","position_detail":"RG","jersey":116,"face":72,"name_rom_offset":3687,"ability_rom_offset":12945,"team_idx":5,"pos_idx":14,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":56,"jerseyNumber":74,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":56}},{"id":165,"team_id":5,"name":"Anthony Munoz","position":"OL","position_detail":"LT","jersey":120,"face":11,"name_rom_offset":3699,"ability_rom_offset":12948,"team_idx":5,"pos_idx":15,"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":75,"jerseyNumber":78,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":75}},{"id":166,"team_id":5,"name":"Joe Walter","position":"OL","position_detail":"RT","jersey":99,"face":75,"name_rom_offset":3712,"ability_rom_offset":12951,"team_idx":5,"pos_idx":16,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":50,"jerseyNumber":63,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":50}},{"id":167,"team_id":5,"name":"Jason Buck","position":"DL","position_detail":"RE","jersey":153,"face":25,"name_rom_offset":3722,"ability_rom_offset":12954,"team_idx":5,"pos_idx":17,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":50,"pass_interceptions":19,"quickness":25,"jerseyNumber":99,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":50,"pass_interceptions":19,"quickness":25}},{"id":168,"team_id":5,"name":"Tim Krumrie","position":"DL","position_detail":"NT","jersey":105,"face":67,"name_rom_offset":3732,"ability_rom_offset":12958,"team_idx":5,"pos_idx":18,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":44,"pass_interceptions":19,"quickness":19,"jerseyNumber":69,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":44,"pass_interceptions":19,"quickness":19}},{"id":169,"team_id":5,"name":"Skip Mcclendon","position":"DL","position_detail":"LE","jersey":114,"face":134,"name_rom_offset":3743,"ability_rom_offset":12962,"team_idx":5,"pos_idx":19,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":44,"pass_interceptions":19,"quickness":31,"jerseyNumber":72,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":44,"pass_interceptions":19,"quickness":31}},{"id":170,"team_id":5,"name":"James Francis","position":"LB","position_detail":"ROLB","jersey":80,"face":192,"name_rom_offset":3757,"ability_rom_offset":12966,"team_idx":5,"pos_idx":20,"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":69,"pass_interceptions":19,"quickness":63,"jerseyNumber":50,"ratings":{"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":69,"pass_interceptions":19,"quickness":63}},{"id":171,"team_id":5,"name":"Kevin Walker","position":"LB","position_detail":"RILB","jersey":89,"face":150,"name_rom_offset":3770,"ability_rom_offset":12970,"team_idx":5,"pos_idx":21,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":19,"quickness":31,"jerseyNumber":59,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":19,"quickness":31}},{"id":172,"team_id":5,"name":"Carl Zander","position":"LB","position_detail":"LILB","jersey":145,"face":36,"name_rom_offset":3782,"ability_rom_offset":12974,"team_idx":5,"pos_idx":22,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":31,"quickness":31,"jerseyNumber":91,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":31,"quickness":31}},{"id":173,"team_id":5,"name":"Leon White","position":"LB","position_detail":"LOLB","jersey":81,"face":143,"name_rom_offset":3793,"ability_rom_offset":12978,"team_idx":5,"pos_idx":23,"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":38,"pass_interceptions":31,"quickness":38,"jerseyNumber":51,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":38,"pass_interceptions":31,"quickness":38}},{"id":174,"team_id":5,"name":"Carl Carter","position":"DB","position_detail":"RCB","jersey":69,"face":198,"name_rom_offset":3803,"ability_rom_offset":12982,"team_idx":5,"pos_idx":24,"rushing_power":31,"running_speed":25,"maximum_speed":25,"hitting_power":31,"pass_interceptions":38,"quickness":25,"jerseyNumber":45,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":25,"hitting_power":31,"pass_interceptions":38,"quickness":25}},{"id":175,"team_id":5,"name":"Lewis Billups","position":"DB","position_detail":"LCB","jersey":36,"face":170,"name_rom_offset":3814,"ability_rom_offset":12986,"team_idx":5,"pos_idx":25,"rushing_power":31,"running_speed":25,"maximum_speed":25,"hitting_power":31,"pass_interceptions":44,"quickness":25,"jerseyNumber":24,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":25,"hitting_power":31,"pass_interceptions":44,"quickness":25}},{"id":176,"team_id":5,"name":"Barney Bussey","position":"DB","position_detail":"FS","jersey":39,"face":189,"name_rom_offset":3827,"ability_rom_offset":12990,"team_idx":5,"pos_idx":26,"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":50,"pass_interceptions":50,"quickness":63,"jerseyNumber":27,"ratings":{"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":50,"pass_interceptions":50,"quickness":63}},{"id":177,"team_id":5,"name":"David Fulcher","position":"DB","position_detail":"SS","jersey":51,"face":138,"name_rom_offset":3840,"ability_rom_offset":12994,"team_idx":5,"pos_idx":27,"rushing_power":56,"running_speed":44,"maximum_speed":69,"hitting_power":75,"pass_interceptions":69,"quickness":75,"jerseyNumber":33,"ratings":{"rushing_power":56,"running_speed":44,"maximum_speed":69,"hitting_power":75,"pass_interceptions":69,"quickness":75}},{"id":178,"team_id":5,"name":"Jim Breech","position":"K","position_detail":"K","jersey":3,"face":32,"name_rom_offset":3853,"ability_rom_offset":12998,"team_idx":5,"pos_idx":28,"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":63,"avoid_kick_block":31,"jerseyNumber":3,"ratings":{"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":63,"avoid_kick_block":31}},{"id":179,"team_id":5,"name":"Lee Johnson","position":"P","position_detail":"P","jersey":17,"face":17,"name_rom_offset":3863,"ability_rom_offset":13002,"team_idx":5,"pos_idx":29,"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":44,"avoid_kick_block":69,"jerseyNumber":11,"ratings":{"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":44,"avoid_kick_block":69}},{"id":180,"team_id":6,"name":"Qb Browns","position":"QB","position_detail":"QB1","jersey":0,"face":82,"name_rom_offset":3874,"ability_rom_offset":13006,"team_idx":6,"pos_idx":0,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"passing_speed":44,"pass_control":75,"accuracy_of_passing":50,"avoid_pass_block":44,"jerseyNumber":0,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"passing_speed":44,"pass_control":75,"accuracy_of_passing":50,"avoid_pass_block":44}},{"id":181,"team_id":6,"name":"Mike Pagel","position":"QB","position_detail":"QB2","jersey":16,"face":70,"name_rom_offset":3883,"ability_rom_offset":13011,"team_idx":6,"pos_idx":1,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"passing_speed":38,"pass_control":31,"accuracy_of_passing":38,"avoid_pass_block":38,"jerseyNumber":10,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"passing_speed":38,"pass_control":31,"accuracy_of_passing":38,"avoid_pass_block":38}},{"id":182,"team_id":6,"name":"Kevin Mack","position":"RB","position_detail":"RB1","jersey":52,"face":192,"name_rom_offset":3893,"ability_rom_offset":13016,"team_idx":6,"pos_idx":2,"rushing_power":69,"running_speed":44,"maximum_speed":31,"hitting_power":88,"ball_control":50,"receptions":44,"jerseyNumber":34,"ratings":{"rushing_power":69,"running_speed":44,"maximum_speed":31,"hitting_power":88,"ball_control":50,"receptions":44}},{"id":183,"team_id":6,"name":"Eric Metcalf","position":"RB","position_detail":"RB2","jersey":33,"face":141,"name_rom_offset":3903,"ability_rom_offset":13020,"team_idx":6,"pos_idx":3,"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":25,"ball_control":50,"receptions":56,"jerseyNumber":21,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":25,"ball_control":50,"receptions":56}},{"id":184,"team_id":6,"name":"Leroy Hoard","position":"RB","position_detail":"RB3","jersey":51,"face":136,"name_rom_offset":3915,"ability_rom_offset":13024,"team_idx":6,"pos_idx":4,"rushing_power":69,"running_speed":44,"maximum_speed":25,"hitting_power":31,"ball_control":50,"receptions":25,"jerseyNumber":33,"ratings":{"rushing_power":69,"running_speed":44,"maximum_speed":25,"hitting_power":31,"ball_control":50,"receptions":25}},{"id":185,"team_id":6,"name":"Brent Fullwood","position":"RB","position_detail":"RB4","jersey":41,"face":199,"name_rom_offset":3926,"ability_rom_offset":13028,"team_idx":6,"pos_idx":5,"rushing_power":69,"running_speed":44,"maximum_speed":25,"hitting_power":38,"ball_control":50,"receptions":25,"jerseyNumber":29,"ratings":{"rushing_power":69,"running_speed":44,"maximum_speed":25,"hitting_power":38,"ball_control":50,"receptions":25}},{"id":186,"team_id":6,"name":"W. Slaughter","position":"WR","position_detail":"WR1","jersey":132,"face":169,"name_rom_offset":3940,"ability_rom_offset":13032,"team_idx":6,"pos_idx":6,"rushing_power":69,"running_speed":31,"maximum_speed":38,"hitting_power":13,"ball_control":50,"receptions":63,"jerseyNumber":84,"ratings":{"rushing_power":69,"running_speed":31,"maximum_speed":38,"hitting_power":13,"ball_control":50,"receptions":63}},{"id":187,"team_id":6,"name":"Reggie Langhorne","position":"WR","position_detail":"WR2","jersey":136,"face":184,"name_rom_offset":3952,"ability_rom_offset":13036,"team_idx":6,"pos_idx":7,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":50,"jerseyNumber":88,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":50}},{"id":188,"team_id":6,"name":"Vernon Joines","position":"WR","position_detail":"WR3","jersey":128,"face":194,"name_rom_offset":3968,"ability_rom_offset":13040,"team_idx":6,"pos_idx":8,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":13,"ball_control":50,"receptions":44,"jerseyNumber":80,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":13,"ball_control":50,"receptions":44}},{"id":189,"team_id":6,"name":"Brian Brennan","position":"WR","position_detail":"WR4","jersey":134,"face":34,"name_rom_offset":3981,"ability_rom_offset":13044,"team_idx":6,"pos_idx":9,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":13,"ball_control":50,"receptions":44,"jerseyNumber":86,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":13,"ball_control":50,"receptions":44}},{"id":190,"team_id":6,"name":"Ozzie Newsome","position":"TE","position_detail":"TE1","jersey":130,"face":159,"name_rom_offset":3994,"ability_rom_offset":13048,"team_idx":6,"pos_idx":10,"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":50,"ball_control":50,"receptions":38,"jerseyNumber":82,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":50,"ball_control":50,"receptions":38}},{"id":191,"team_id":6,"name":"John Talley","position":"TE","position_detail":"TE2","jersey":135,"face":198,"name_rom_offset":4007,"ability_rom_offset":13052,"team_idx":6,"pos_idx":11,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":38,"ball_control":50,"receptions":25,"jerseyNumber":87,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":38,"ball_control":50,"receptions":25}},{"id":192,"team_id":6,"name":"Mike Baab","position":"OL","position_detail":"C","jersey":97,"face":35,"name_rom_offset":4018,"ability_rom_offset":13056,"team_idx":6,"pos_idx":12,"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":44,"jerseyNumber":61,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":44}},{"id":193,"team_id":6,"name":"Ralph Tamm","position":"OL","position_detail":"LG","jersey":101,"face":56,"name_rom_offset":4027,"ability_rom_offset":13059,"team_idx":6,"pos_idx":13,"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":50,"jerseyNumber":65,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":50}},{"id":194,"team_id":6,"name":"Gregg Rakoczy","position":"OL","position_detail":"RG","jersey":115,"face":57,"name_rom_offset":4037,"ability_rom_offset":13062,"team_idx":6,"pos_idx":14,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":50,"jerseyNumber":73,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":50}},{"id":195,"team_id":6,"name":"Paul Farren","position":"OL","position_detail":"LT","jersey":116,"face":50,"name_rom_offset":4050,"ability_rom_offset":13065,"team_idx":6,"pos_idx":15,"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":44,"jerseyNumber":74,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":44}},{"id":196,"team_id":6,"name":"Tony Jones","position":"OL","position_detail":"RT","jersey":102,"face":167,"name_rom_offset":4061,"ability_rom_offset":13068,"team_idx":6,"pos_idx":16,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":50,"jerseyNumber":66,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":50}},{"id":197,"team_id":6,"name":"Robert Banks","position":"DL","position_detail":"RE","jersey":151,"face":177,"name_rom_offset":4071,"ability_rom_offset":13071,"team_idx":6,"pos_idx":17,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":50,"pass_interceptions":19,"quickness":38,"jerseyNumber":97,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":50,"pass_interceptions":19,"quickness":38}},{"id":198,"team_id":6,"name":"Chris Pike","position":"DL","position_detail":"NT","jersey":117,"face":160,"name_rom_offset":4083,"ability_rom_offset":13075,"team_idx":6,"pos_idx":18,"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":56,"pass_interceptions":19,"quickness":19,"jerseyNumber":75,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":56,"pass_interceptions":19,"quickness":19}},{"id":199,"team_id":6,"name":"Al Baker","position":"DL","position_detail":"LE","jersey":96,"face":183,"name_rom_offset":4093,"ability_rom_offset":13079,"team_idx":6,"pos_idx":19,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":50,"pass_interceptions":19,"quickness":38,"jerseyNumber":60,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":50,"pass_interceptions":19,"quickness":38}},{"id":200,"team_id":6,"name":"Tony Blaylock","position":"LB","position_detail":"ROLB","jersey":36,"face":155,"name_rom_offset":4101,"ability_rom_offset":13083,"team_idx":6,"pos_idx":20,"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":38,"pass_interceptions":38,"quickness":38,"jerseyNumber":24,"ratings":{"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":38,"pass_interceptions":38,"quickness":38}},{"id":201,"team_id":6,"name":"David Grayson","position":"LB","position_detail":"RILB","jersey":86,"face":152,"name_rom_offset":4114,"ability_rom_offset":13087,"team_idx":6,"pos_idx":21,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":31,"quickness":38,"jerseyNumber":56,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":31,"quickness":38}},{"id":202,"team_id":6,"name":"Mike Johnson","position":"LB","position_detail":"LILB","jersey":89,"face":128,"name_rom_offset":4127,"ability_rom_offset":13091,"team_idx":6,"pos_idx":22,"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":69,"pass_interceptions":19,"quickness":63,"jerseyNumber":59,"ratings":{"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":69,"pass_interceptions":19,"quickness":63}},{"id":203,"team_id":6,"name":"Clay Matthews","position":"LB","position_detail":"LOLB","jersey":87,"face":78,"name_rom_offset":4139,"ability_rom_offset":13095,"team_idx":6,"pos_idx":23,"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":38,"pass_interceptions":19,"quickness":38,"jerseyNumber":57,"ratings":{"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":38,"pass_interceptions":19,"quickness":38}},{"id":204,"team_id":6,"name":"Raymond Clayborn","position":"DB","position_detail":"RCB","jersey":38,"face":196,"name_rom_offset":4152,"ability_rom_offset":13099,"team_idx":6,"pos_idx":24,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":31,"quickness":31,"jerseyNumber":26,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":31,"quickness":31}},{"id":205,"team_id":6,"name":"Frank Minnifield","position":"DB","position_detail":"LCB","jersey":49,"face":161,"name_rom_offset":4168,"ability_rom_offset":13103,"team_idx":6,"pos_idx":25,"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":50,"pass_interceptions":44,"quickness":50,"jerseyNumber":31,"ratings":{"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":50,"pass_interceptions":44,"quickness":50}},{"id":206,"team_id":6,"name":"Thane Gash","position":"DB","position_detail":"FS","jersey":48,"face":137,"name_rom_offset":4184,"ability_rom_offset":13107,"team_idx":6,"pos_idx":26,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":44,"pass_interceptions":31,"quickness":31,"jerseyNumber":30,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":44,"pass_interceptions":31,"quickness":31}},{"id":207,"team_id":6,"name":"Felix Wright","position":"DB","position_detail":"SS","jersey":34,"face":133,"name_rom_offset":4194,"ability_rom_offset":13111,"team_idx":6,"pos_idx":27,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":50,"quickness":44,"jerseyNumber":22,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":50,"quickness":44}},{"id":208,"team_id":6,"name":"Jerry Kauric","position":"K","position_detail":"K","jersey":2,"face":40,"name_rom_offset":4206,"ability_rom_offset":13115,"team_idx":6,"pos_idx":28,"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":38,"avoid_kick_block":31,"jerseyNumber":2,"ratings":{"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":38,"avoid_kick_block":31}},{"id":209,"team_id":6,"name":"Bryan Wagner","position":"P","position_detail":"P","jersey":21,"face":9,"name_rom_offset":4218,"ability_rom_offset":13119,"team_idx":6,"pos_idx":29,"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":25,"avoid_kick_block":19,"jerseyNumber":15,"ratings":{"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":25,"avoid_kick_block":19}},{"id":210,"team_id":7,"name":"Warren Moon","position":"QB","position_detail":"QB1","jersey":1,"face":139,"name_rom_offset":4230,"ability_rom_offset":13123,"team_idx":7,"pos_idx":0,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":13,"passing_speed":69,"pass_control":75,"accuracy_of_passing":75,"avoid_pass_block":63,"jerseyNumber":1,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":13,"passing_speed":69,"pass_control":75,"accuracy_of_passing":75,"avoid_pass_block":63}},{"id":211,"team_id":7,"name":"Cody Carlson","position":"QB","position_detail":"QB2","jersey":20,"face":9,"name_rom_offset":4241,"ability_rom_offset":13128,"team_idx":7,"pos_idx":1,"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":44,"pass_control":31,"accuracy_of_passing":38,"avoid_pass_block":44,"jerseyNumber":14,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":44,"pass_control":31,"accuracy_of_passing":38,"avoid_pass_block":44}},{"id":212,"team_id":7,"name":"Lorenzo White","position":"RB","position_detail":"RB1","jersey":68,"face":191,"name_rom_offset":4253,"ability_rom_offset":13133,"team_idx":7,"pos_idx":2,"rushing_power":69,"running_speed":38,"maximum_speed":44,"hitting_power":38,"ball_control":19,"receptions":44,"jerseyNumber":44,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":44,"hitting_power":38,"ball_control":19,"receptions":44}},{"id":213,"team_id":7,"name":"Ernest Givins","position":"RB","position_detail":"RB2","jersey":129,"face":137,"name_rom_offset":4266,"ability_rom_offset":13137,"team_idx":7,"pos_idx":3,"rushing_power":69,"running_speed":44,"maximum_speed":56,"hitting_power":13,"ball_control":81,"receptions":75,"jerseyNumber":81,"ratings":{"rushing_power":69,"running_speed":44,"maximum_speed":56,"hitting_power":13,"ball_control":81,"receptions":75}},{"id":214,"team_id":7,"name":"Allen Pinkett","position":"RB","position_detail":"RB3","jersey":32,"face":156,"name_rom_offset":4279,"ability_rom_offset":13141,"team_idx":7,"pos_idx":4,"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":25,"ball_control":81,"receptions":25,"jerseyNumber":20,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":25,"ball_control":81,"receptions":25}},{"id":215,"team_id":7,"name":"Victor Jones","position":"RB","position_detail":"RB4","jersey":55,"face":131,"name_rom_offset":4292,"ability_rom_offset":13145,"team_idx":7,"pos_idx":5,"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":25,"ball_control":81,"receptions":25,"jerseyNumber":37,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":25,"ball_control":81,"receptions":25}},{"id":216,"team_id":7,"name":"Haywood Jeffries","position":"WR","position_detail":"WR1","jersey":132,"face":155,"name_rom_offset":4304,"ability_rom_offset":13149,"team_idx":7,"pos_idx":6,"rushing_power":69,"running_speed":38,"maximum_speed":50,"hitting_power":13,"ball_control":81,"receptions":75,"jerseyNumber":84,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":50,"hitting_power":13,"ball_control":81,"receptions":75}},{"id":217,"team_id":7,"name":"Drew Hill","position":"WR","position_detail":"WR2","jersey":133,"face":199,"name_rom_offset":4320,"ability_rom_offset":13153,"team_idx":7,"pos_idx":7,"rushing_power":69,"running_speed":44,"maximum_speed":63,"hitting_power":13,"ball_control":81,"receptions":75,"jerseyNumber":85,"ratings":{"rushing_power":69,"running_speed":44,"maximum_speed":63,"hitting_power":13,"ball_control":81,"receptions":75}},{"id":218,"team_id":7,"name":"Doug Lloyd","position":"WR","position_detail":"WR3","jersey":53,"face":79,"name_rom_offset":4329,"ability_rom_offset":13157,"team_idx":7,"pos_idx":8,"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":25,"ball_control":81,"receptions":25,"jerseyNumber":35,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":25,"ball_control":81,"receptions":25}},{"id":219,"team_id":7,"name":"Tony Jones","position":"WR","position_detail":"WR4","jersey":130,"face":154,"name_rom_offset":4339,"ability_rom_offset":13161,"team_idx":7,"pos_idx":9,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":13,"ball_control":81,"receptions":50,"jerseyNumber":82,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":13,"ball_control":81,"receptions":50}},{"id":220,"team_id":7,"name":"Curtis Duncan","position":"TE","position_detail":"TE1","jersey":128,"face":196,"name_rom_offset":4349,"ability_rom_offset":13165,"team_idx":7,"pos_idx":10,"rushing_power":69,"running_speed":38,"maximum_speed":50,"hitting_power":13,"ball_control":81,"receptions":63,"jerseyNumber":80,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":50,"hitting_power":13,"ball_control":81,"receptions":63}},{"id":221,"team_id":7,"name":"Gerald Mcneil","position":"TE","position_detail":"TE2","jersey":137,"face":192,"name_rom_offset":4362,"ability_rom_offset":13169,"team_idx":7,"pos_idx":11,"rushing_power":69,"running_speed":25,"maximum_speed":44,"hitting_power":13,"ball_control":81,"receptions":44,"jerseyNumber":89,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":44,"hitting_power":13,"ball_control":81,"receptions":44}},{"id":222,"team_id":7,"name":"Jay Pennison","position":"OL","position_detail":"C","jersey":82,"face":71,"name_rom_offset":4375,"ability_rom_offset":13173,"team_idx":7,"pos_idx":12,"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":50,"jerseyNumber":52,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":50}},{"id":223,"team_id":7,"name":"Mike Munchak","position":"OL","position_detail":"LG","jersey":99,"face":44,"name_rom_offset":4387,"ability_rom_offset":13176,"team_idx":7,"pos_idx":13,"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":63,"jerseyNumber":63,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":63}},{"id":224,"team_id":7,"name":"Bruce Matthews","position":"OL","position_detail":"RG","jersey":116,"face":40,"name_rom_offset":4399,"ability_rom_offset":13179,"team_idx":7,"pos_idx":14,"rushing_power":69,"running_speed":25,"maximum_speed":44,"hitting_power":69,"jerseyNumber":74,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":44,"hitting_power":69}},{"id":225,"team_id":7,"name":"Don Maggs","position":"OL","position_detail":"LT","jersey":120,"face":68,"name_rom_offset":4413,"ability_rom_offset":13182,"team_idx":7,"pos_idx":15,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":50,"jerseyNumber":78,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":50}},{"id":226,"team_id":7,"name":"Dean Steinkuhler","position":"OL","position_detail":"RT","jersey":112,"face":30,"name_rom_offset":4422,"ability_rom_offset":13185,"team_idx":7,"pos_idx":16,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":50,"jerseyNumber":70,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":50}},{"id":227,"team_id":7,"name":"Sean Jones","position":"DL","position_detail":"RE","jersey":150,"face":143,"name_rom_offset":4438,"ability_rom_offset":13188,"team_idx":7,"pos_idx":17,"rushing_power":50,"running_speed":38,"maximum_speed":56,"hitting_power":56,"pass_interceptions":19,"quickness":56,"jerseyNumber":96,"ratings":{"rushing_power":50,"running_speed":38,"maximum_speed":56,"hitting_power":56,"pass_interceptions":19,"quickness":56}},{"id":228,"team_id":7,"name":"Doug Smith","position":"DL","position_detail":"NT","jersey":153,"face":174,"name_rom_offset":4448,"ability_rom_offset":13192,"team_idx":7,"pos_idx":18,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":50,"pass_interceptions":19,"quickness":44,"jerseyNumber":99,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":50,"pass_interceptions":19,"quickness":44}},{"id":229,"team_id":7,"name":"William Fuller","position":"DL","position_detail":"LE","jersey":149,"face":200,"name_rom_offset":4458,"ability_rom_offset":13196,"team_idx":7,"pos_idx":19,"rushing_power":38,"running_speed":25,"maximum_speed":50,"hitting_power":56,"pass_interceptions":19,"quickness":56,"jerseyNumber":95,"ratings":{"rushing_power":38,"running_speed":25,"maximum_speed":50,"hitting_power":56,"pass_interceptions":19,"quickness":56}},{"id":230,"team_id":7,"name":"Johnny Meads","position":"LB","position_detail":"ROLB","jersey":145,"face":165,"name_rom_offset":4472,"ability_rom_offset":13200,"team_idx":7,"pos_idx":20,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":31,"pass_interceptions":31,"quickness":38,"jerseyNumber":91,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":31,"pass_interceptions":31,"quickness":38}},{"id":231,"team_id":7,"name":"Al Smith","position":"LB","position_detail":"RILB","jersey":84,"face":198,"name_rom_offset":4484,"ability_rom_offset":13204,"team_idx":7,"pos_idx":21,"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":38,"pass_interceptions":19,"quickness":38,"jerseyNumber":54,"ratings":{"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":38,"pass_interceptions":19,"quickness":38}},{"id":232,"team_id":7,"name":"John Grimsley","position":"LB","position_detail":"LILB","jersey":89,"face":53,"name_rom_offset":4492,"ability_rom_offset":13208,"team_idx":7,"pos_idx":22,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":31,"pass_interceptions":19,"quickness":38,"jerseyNumber":59,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":31,"pass_interceptions":19,"quickness":38}},{"id":233,"team_id":7,"name":"Ray Childress","position":"LB","position_detail":"LOLB","jersey":121,"face":12,"name_rom_offset":4505,"ability_rom_offset":13212,"team_idx":7,"pos_idx":23,"rushing_power":50,"running_speed":38,"maximum_speed":56,"hitting_power":63,"pass_interceptions":19,"quickness":69,"jerseyNumber":79,"ratings":{"rushing_power":50,"running_speed":38,"maximum_speed":56,"hitting_power":63,"pass_interceptions":19,"quickness":69}},{"id":234,"team_id":7,"name":"Richard Johnson","position":"DB","position_detail":"RCB","jersey":35,"face":150,"name_rom_offset":4518,"ability_rom_offset":13216,"team_idx":7,"pos_idx":24,"rushing_power":50,"running_speed":38,"maximum_speed":63,"hitting_power":44,"pass_interceptions":75,"quickness":75,"jerseyNumber":23,"ratings":{"rushing_power":50,"running_speed":38,"maximum_speed":63,"hitting_power":44,"pass_interceptions":75,"quickness":75}},{"id":235,"team_id":7,"name":"Cris Dishman","position":"DB","position_detail":"LCB","jersey":40,"face":129,"name_rom_offset":4533,"ability_rom_offset":13220,"team_idx":7,"pos_idx":25,"rushing_power":31,"running_speed":25,"maximum_speed":44,"hitting_power":31,"pass_interceptions":56,"quickness":50,"jerseyNumber":28,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":44,"hitting_power":31,"pass_interceptions":56,"quickness":50}},{"id":236,"team_id":7,"name":"Terry Kinard","position":"DB","position_detail":"FS","jersey":39,"face":146,"name_rom_offset":4545,"ability_rom_offset":13224,"team_idx":7,"pos_idx":26,"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":44,"pass_interceptions":56,"quickness":44,"jerseyNumber":27,"ratings":{"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":44,"pass_interceptions":56,"quickness":44}},{"id":237,"team_id":7,"name":"Bubba Mcdowell","position":"DB","position_detail":"SS","jersey":37,"face":193,"name_rom_offset":4557,"ability_rom_offset":13228,"team_idx":7,"pos_idx":27,"rushing_power":31,"running_speed":25,"maximum_speed":44,"hitting_power":44,"pass_interceptions":50,"quickness":44,"jerseyNumber":25,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":44,"hitting_power":44,"pass_interceptions":50,"quickness":44}},{"id":238,"team_id":7,"name":"Tony Zendejas","position":"K","position_detail":"K","jersey":7,"face":46,"name_rom_offset":4571,"ability_rom_offset":13232,"team_idx":7,"pos_idx":28,"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":38,"avoid_kick_block":31,"jerseyNumber":7,"ratings":{"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":38,"avoid_kick_block":31}},{"id":239,"team_id":7,"name":"Greg Montgomery","position":"P","position_detail":"P","jersey":9,"face":19,"name_rom_offset":4584,"ability_rom_offset":13236,"team_idx":7,"pos_idx":29,"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":69,"avoid_kick_block":56,"jerseyNumber":9,"ratings":{"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":69,"avoid_kick_block":56}},{"id":240,"team_id":8,"name":"Bubby Brister","position":"QB","position_detail":"QB1","jersey":6,"face":29,"name_rom_offset":4599,"ability_rom_offset":13240,"team_idx":8,"pos_idx":0,"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":75,"pass_control":25,"accuracy_of_passing":56,"avoid_pass_block":38,"jerseyNumber":6,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":75,"pass_control":25,"accuracy_of_passing":56,"avoid_pass_block":38}},{"id":241,"team_id":8,"name":"Rick Strom","position":"QB","position_detail":"QB2","jersey":17,"face":66,"name_rom_offset":4612,"ability_rom_offset":13245,"team_idx":8,"pos_idx":1,"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":44,"pass_control":38,"accuracy_of_passing":25,"avoid_pass_block":38,"jerseyNumber":11,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":44,"pass_control":38,"accuracy_of_passing":25,"avoid_pass_block":38}},{"id":242,"team_id":8,"name":"Merril Hoge","position":"RB","position_detail":"RB1","jersey":51,"face":19,"name_rom_offset":4622,"ability_rom_offset":13250,"team_idx":8,"pos_idx":2,"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":38,"ball_control":81,"receptions":44,"jerseyNumber":33,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":38,"ball_control":81,"receptions":44}},{"id":243,"team_id":8,"name":"Warren Williams","position":"RB","position_detail":"RB2","jersey":66,"face":199,"name_rom_offset":4633,"ability_rom_offset":13254,"team_idx":8,"pos_idx":3,"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":31,"ball_control":81,"receptions":44,"jerseyNumber":42,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":31,"ball_control":81,"receptions":44}},{"id":244,"team_id":8,"name":"Tim Worley","position":"RB","position_detail":"RB3","jersey":56,"face":163,"name_rom_offset":4648,"ability_rom_offset":13258,"team_idx":8,"pos_idx":4,"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":31,"ball_control":81,"receptions":25,"jerseyNumber":38,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":31,"ball_control":81,"receptions":25}},{"id":245,"team_id":8,"name":"Richard Bell","position":"RB","position_detail":"RB4","jersey":33,"face":195,"name_rom_offset":4658,"ability_rom_offset":13262,"team_idx":8,"pos_idx":5,"rushing_power":69,"running_speed":38,"maximum_speed":31,"hitting_power":19,"ball_control":81,"receptions":25,"jerseyNumber":21,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":31,"hitting_power":19,"ball_control":81,"receptions":25}},{"id":246,"team_id":8,"name":"Louis Lipps","position":"WR","position_detail":"WR1","jersey":131,"face":165,"name_rom_offset":4670,"ability_rom_offset":13266,"team_idx":8,"pos_idx":6,"rushing_power":69,"running_speed":31,"maximum_speed":31,"hitting_power":13,"ball_control":81,"receptions":56,"jerseyNumber":83,"ratings":{"rushing_power":69,"running_speed":31,"maximum_speed":31,"hitting_power":13,"ball_control":81,"receptions":56}},{"id":247,"team_id":8,"name":"Derek Hill","position":"WR","position_detail":"WR2","jersey":130,"face":205,"name_rom_offset":4681,"ability_rom_offset":13270,"team_idx":8,"pos_idx":7,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":81,"receptions":44,"jerseyNumber":82,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":81,"receptions":44}},{"id":248,"team_id":8,"name":"Chris Calloway","position":"WR","position_detail":"WR3","jersey":136,"face":159,"name_rom_offset":4691,"ability_rom_offset":13274,"team_idx":8,"pos_idx":8,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":13,"ball_control":81,"receptions":44,"jerseyNumber":88,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":13,"ball_control":81,"receptions":44}},{"id":249,"team_id":8,"name":"Dwight Stone","position":"WR","position_detail":"WR4","jersey":32,"face":139,"name_rom_offset":4705,"ability_rom_offset":13278,"team_idx":8,"pos_idx":9,"rushing_power":69,"running_speed":31,"maximum_speed":31,"hitting_power":13,"ball_control":81,"receptions":44,"jerseyNumber":20,"ratings":{"rushing_power":69,"running_speed":31,"maximum_speed":31,"hitting_power":13,"ball_control":81,"receptions":44}},{"id":250,"team_id":8,"name":"Eric Green","position":"TE","position_detail":"TE1","jersey":134,"face":192,"name_rom_offset":4717,"ability_rom_offset":13282,"team_idx":8,"pos_idx":10,"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":63,"ball_control":81,"receptions":44,"jerseyNumber":86,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":63,"ball_control":81,"receptions":44}},{"id":251,"team_id":8,"name":"Mike Mularkey","position":"TE","position_detail":"TE2","jersey":132,"face":54,"name_rom_offset":4727,"ability_rom_offset":13286,"team_idx":8,"pos_idx":11,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":44,"ball_control":81,"receptions":44,"jerseyNumber":84,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":44,"ball_control":81,"receptions":44}},{"id":252,"team_id":8,"name":"Dermontti Dawson","position":"OL","position_detail":"C","jersey":99,"face":168,"name_rom_offset":4740,"ability_rom_offset":13290,"team_idx":8,"pos_idx":12,"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":56,"jerseyNumber":63,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":56}},{"id":253,"team_id":8,"name":"B. Blankenship","position":"OL","position_detail":"LG","jersey":96,"face":42,"name_rom_offset":4756,"ability_rom_offset":13293,"team_idx":8,"pos_idx":13,"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":44,"jerseyNumber":60,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":44}},{"id":254,"team_id":8,"name":"Terry Long","position":"OL","position_detail":"RG","jersey":116,"face":198,"name_rom_offset":4770,"ability_rom_offset":13296,"team_idx":8,"pos_idx":14,"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":44,"jerseyNumber":74,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":44}},{"id":255,"team_id":8,"name":"John Jackson","position":"OL","position_detail":"LT","jersey":101,"face":166,"name_rom_offset":4780,"ability_rom_offset":13299,"team_idx":8,"pos_idx":15,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":50,"jerseyNumber":65,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":50}},{"id":256,"team_id":8,"name":"Tunch Ilkin","position":"OL","position_detail":"RT","jersey":98,"face":50,"name_rom_offset":4792,"ability_rom_offset":13302,"team_idx":8,"pos_idx":16,"rushing_power":69,"running_speed":25,"maximum_speed":44,"hitting_power":69,"jerseyNumber":62,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":44,"hitting_power":69}},{"id":257,"team_id":8,"name":"Donald Evans","position":"DL","position_detail":"RE","jersey":102,"face":188,"name_rom_offset":4803,"ability_rom_offset":13305,"team_idx":8,"pos_idx":17,"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":50,"pass_interceptions":19,"quickness":56,"jerseyNumber":66,"ratings":{"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":50,"pass_interceptions":19,"quickness":56}},{"id":258,"team_id":8,"name":"Gerald Williams","position":"DL","position_detail":"NT","jersey":152,"face":128,"name_rom_offset":4815,"ability_rom_offset":13309,"team_idx":8,"pos_idx":18,"rushing_power":44,"running_speed":38,"maximum_speed":50,"hitting_power":56,"pass_interceptions":19,"quickness":75,"jerseyNumber":98,"ratings":{"rushing_power":44,"running_speed":38,"maximum_speed":50,"hitting_power":56,"pass_interceptions":19,"quickness":75}},{"id":259,"team_id":8,"name":"Keith Willis","position":"DL","position_detail":"LE","jersey":147,"face":147,"name_rom_offset":4830,"ability_rom_offset":13313,"team_idx":8,"pos_idx":19,"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":44,"pass_interceptions":19,"quickness":56,"jerseyNumber":93,"ratings":{"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":44,"pass_interceptions":19,"quickness":56}},{"id":260,"team_id":8,"name":"Greg Lloyd","position":"LB","position_detail":"ROLB","jersey":149,"face":150,"name_rom_offset":4842,"ability_rom_offset":13317,"team_idx":8,"pos_idx":20,"rushing_power":50,"running_speed":38,"maximum_speed":56,"hitting_power":63,"pass_interceptions":31,"quickness":69,"jerseyNumber":95,"ratings":{"rushing_power":50,"running_speed":38,"maximum_speed":56,"hitting_power":63,"pass_interceptions":31,"quickness":69}},{"id":261,"team_id":8,"name":"David Little","position":"LB","position_detail":"RILB","jersey":80,"face":202,"name_rom_offset":4852,"ability_rom_offset":13321,"team_idx":8,"pos_idx":21,"rushing_power":44,"running_speed":38,"maximum_speed":56,"hitting_power":50,"pass_interceptions":31,"quickness":63,"jerseyNumber":50,"ratings":{"rushing_power":44,"running_speed":38,"maximum_speed":56,"hitting_power":50,"pass_interceptions":31,"quickness":63}},{"id":262,"team_id":8,"name":"Hardy Nickerson","position":"LB","position_detail":"LILB","jersey":84,"face":203,"name_rom_offset":4864,"ability_rom_offset":13325,"team_idx":8,"pos_idx":22,"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":44,"pass_interceptions":19,"quickness":56,"jerseyNumber":54,"ratings":{"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":44,"pass_interceptions":19,"quickness":56}},{"id":263,"team_id":8,"name":"Bryan Hinkle","position":"LB","position_detail":"LOLB","jersey":83,"face":75,"name_rom_offset":4879,"ability_rom_offset":13329,"team_idx":8,"pos_idx":23,"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":44,"pass_interceptions":19,"quickness":56,"jerseyNumber":53,"ratings":{"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":44,"pass_interceptions":19,"quickness":56}},{"id":264,"team_id":8,"name":"Rod Woodson","position":"DB","position_detail":"RCB","jersey":38,"face":59,"name_rom_offset":4891,"ability_rom_offset":13333,"team_idx":8,"pos_idx":24,"rushing_power":56,"running_speed":44,"maximum_speed":75,"hitting_power":69,"pass_interceptions":63,"quickness":75,"jerseyNumber":26,"ratings":{"rushing_power":56,"running_speed":44,"maximum_speed":75,"hitting_power":69,"pass_interceptions":63,"quickness":75}},{"id":265,"team_id":8,"name":"Dwayne Woodruff","position":"DB","position_detail":"LCB","jersey":73,"face":143,"name_rom_offset":4902,"ability_rom_offset":13337,"team_idx":8,"pos_idx":25,"rushing_power":44,"running_speed":38,"maximum_speed":56,"hitting_power":56,"pass_interceptions":56,"quickness":56,"jerseyNumber":49,"ratings":{"rushing_power":44,"running_speed":38,"maximum_speed":56,"hitting_power":56,"pass_interceptions":56,"quickness":56}},{"id":266,"team_id":8,"name":"Thomas Everett","position":"DB","position_detail":"FS","jersey":39,"face":176,"name_rom_offset":4917,"ability_rom_offset":13341,"team_idx":8,"pos_idx":26,"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":38,"pass_interceptions":56,"quickness":44,"jerseyNumber":27,"ratings":{"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":38,"pass_interceptions":56,"quickness":44}},{"id":267,"team_id":8,"name":"Carnell Lake","position":"DB","position_detail":"SS","jersey":55,"face":130,"name_rom_offset":4931,"ability_rom_offset":13345,"team_idx":8,"pos_idx":27,"rushing_power":44,"running_speed":38,"maximum_speed":56,"hitting_power":50,"pass_interceptions":50,"quickness":63,"jerseyNumber":37,"ratings":{"rushing_power":44,"running_speed":38,"maximum_speed":56,"hitting_power":50,"pass_interceptions":50,"quickness":63}},{"id":268,"team_id":8,"name":"Gary Anderson","position":"K","position_detail":"K","jersey":1,"face":21,"name_rom_offset":4943,"ability_rom_offset":13349,"team_idx":8,"pos_idx":28,"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":63,"avoid_kick_block":50,"jerseyNumber":1,"ratings":{"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":63,"avoid_kick_block":50}},{"id":269,"team_id":8,"name":"Dan Stryzinski","position":"P","position_detail":"P","jersey":4,"face":33,"name_rom_offset":4956,"ability_rom_offset":13353,"team_idx":8,"pos_idx":29,"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":38,"avoid_kick_block":50,"jerseyNumber":4,"ratings":{"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":38,"avoid_kick_block":50}},{"id":270,"team_id":9,"name":"John Elway","position":"QB","position_detail":"QB1","jersey":7,"face":14,"name_rom_offset":4970,"ability_rom_offset":13357,"team_idx":9,"pos_idx":0,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"passing_speed":75,"pass_control":31,"accuracy_of_passing":69,"avoid_pass_block":50,"jerseyNumber":7,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"passing_speed":75,"pass_control":31,"accuracy_of_passing":69,"avoid_pass_block":50}},{"id":271,"team_id":9,"name":"Gary Kubiak","position":"QB","position_detail":"QB2","jersey":8,"face":23,"name_rom_offset":4980,"ability_rom_offset":13362,"team_idx":9,"pos_idx":1,"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":44,"pass_control":38,"accuracy_of_passing":31,"avoid_pass_block":38,"jerseyNumber":8,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":44,"pass_control":38,"accuracy_of_passing":31,"avoid_pass_block":38}},{"id":272,"team_id":9,"name":"Bobby Humphrey","position":"RB","position_detail":"RB1","jersey":38,"face":140,"name_rom_offset":4991,"ability_rom_offset":13367,"team_idx":9,"pos_idx":2,"rushing_power":69,"running_speed":38,"maximum_speed":63,"hitting_power":38,"ball_control":50,"receptions":38,"jerseyNumber":26,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":63,"hitting_power":38,"ball_control":50,"receptions":38}},{"id":273,"team_id":9,"name":"Steve Sewell","position":"RB","position_detail":"RB2","jersey":48,"face":131,"name_rom_offset":5005,"ability_rom_offset":13371,"team_idx":9,"pos_idx":3,"rushing_power":69,"running_speed":38,"maximum_speed":25,"hitting_power":25,"ball_control":50,"receptions":50,"jerseyNumber":30,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":25,"hitting_power":25,"ball_control":50,"receptions":50}},{"id":274,"team_id":9,"name":"Sammy Winder","position":"RB","position_detail":"RB3","jersey":35,"face":178,"name_rom_offset":5017,"ability_rom_offset":13375,"team_idx":9,"pos_idx":4,"rushing_power":69,"running_speed":44,"maximum_speed":25,"hitting_power":31,"ball_control":50,"receptions":25,"jerseyNumber":23,"ratings":{"rushing_power":69,"running_speed":44,"maximum_speed":25,"hitting_power":31,"ball_control":50,"receptions":25}},{"id":275,"team_id":9,"name":"Melvin Bratton","position":"RB","position_detail":"RB4","jersey":50,"face":188,"name_rom_offset":5029,"ability_rom_offset":13379,"team_idx":9,"pos_idx":5,"rushing_power":69,"running_speed":44,"maximum_speed":25,"hitting_power":44,"ball_control":50,"receptions":38,"jerseyNumber":32,"ratings":{"rushing_power":69,"running_speed":44,"maximum_speed":25,"hitting_power":44,"ball_control":50,"receptions":38}},{"id":276,"team_id":9,"name":"Vance Johnson","position":"WR","position_detail":"WR1","jersey":130,"face":158,"name_rom_offset":5043,"ability_rom_offset":13383,"team_idx":9,"pos_idx":6,"rushing_power":69,"running_speed":38,"maximum_speed":50,"hitting_power":13,"ball_control":50,"receptions":56,"jerseyNumber":82,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":50,"hitting_power":13,"ball_control":50,"receptions":56}},{"id":277,"team_id":9,"name":"Mark Jackson","position":"WR","position_detail":"WR2","jersey":128,"face":176,"name_rom_offset":5056,"ability_rom_offset":13387,"team_idx":9,"pos_idx":7,"rushing_power":69,"running_speed":38,"maximum_speed":44,"hitting_power":13,"ball_control":50,"receptions":69,"jerseyNumber":80,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":44,"hitting_power":13,"ball_control":50,"receptions":69}},{"id":278,"team_id":9,"name":"Ricky Nattiel","position":"WR","position_detail":"WR3","jersey":132,"face":141,"name_rom_offset":5068,"ability_rom_offset":13391,"team_idx":9,"pos_idx":8,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":44,"jerseyNumber":84,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":44}},{"id":279,"team_id":9,"name":"Michael Young","position":"WR","position_detail":"WR4","jersey":131,"face":33,"name_rom_offset":5081,"ability_rom_offset":13395,"team_idx":9,"pos_idx":9,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":50,"jerseyNumber":83,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":50}},{"id":280,"team_id":9,"name":"Clarence Kay","position":"TE","position_detail":"TE1","jersey":136,"face":161,"name_rom_offset":5094,"ability_rom_offset":13399,"team_idx":9,"pos_idx":10,"rushing_power":69,"running_speed":31,"maximum_speed":31,"hitting_power":50,"ball_control":50,"receptions":44,"jerseyNumber":88,"ratings":{"rushing_power":69,"running_speed":31,"maximum_speed":31,"hitting_power":50,"ball_control":50,"receptions":44}},{"id":281,"team_id":9,"name":"Paul Green","position":"TE","position_detail":"TE2","jersey":135,"face":47,"name_rom_offset":5106,"ability_rom_offset":13403,"team_idx":9,"pos_idx":11,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":44,"ball_control":50,"receptions":31,"jerseyNumber":87,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":44,"ball_control":50,"receptions":31}},{"id":282,"team_id":9,"name":"Keith Kartz","position":"OL","position_detail":"C","jersey":114,"face":51,"name_rom_offset":5116,"ability_rom_offset":13407,"team_idx":9,"pos_idx":12,"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":44,"jerseyNumber":72,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":44}},{"id":283,"team_id":9,"name":"Jim Juriga","position":"OL","position_detail":"LG","jersey":102,"face":52,"name_rom_offset":5127,"ability_rom_offset":13410,"team_idx":9,"pos_idx":13,"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":44,"jerseyNumber":66,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":44}},{"id":284,"team_id":9,"name":"Doug Widell","position":"OL","position_detail":"RG","jersey":103,"face":16,"name_rom_offset":5137,"ability_rom_offset":13413,"team_idx":9,"pos_idx":14,"rushing_power":31,"running_speed":69,"maximum_speed":44,"hitting_power":44,"jerseyNumber":67,"ratings":{"rushing_power":31,"running_speed":69,"maximum_speed":44,"hitting_power":44}},{"id":285,"team_id":9,"name":"Darrell Hamilton","position":"OL","position_detail":"LT","jersey":105,"face":192,"name_rom_offset":5148,"ability_rom_offset":13416,"team_idx":9,"pos_idx":15,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":56,"jerseyNumber":69,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":56}},{"id":286,"team_id":9,"name":"Ken Lanier","position":"OL","position_detail":"RT","jersey":118,"face":175,"name_rom_offset":5164,"ability_rom_offset":13419,"team_idx":9,"pos_idx":16,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":50,"jerseyNumber":76,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":50}},{"id":287,"team_id":9,"name":"Ron Holmes","position":"DL","position_detail":"RE","jersey":144,"face":136,"name_rom_offset":5174,"ability_rom_offset":13422,"team_idx":9,"pos_idx":17,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":44,"pass_interceptions":19,"quickness":31,"jerseyNumber":90,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":44,"pass_interceptions":19,"quickness":31}},{"id":288,"team_id":9,"name":"Greg Kragen","position":"DL","position_detail":"NT","jersey":113,"face":67,"name_rom_offset":5184,"ability_rom_offset":13426,"team_idx":9,"pos_idx":18,"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":44,"pass_interceptions":19,"quickness":31,"jerseyNumber":71,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":44,"pass_interceptions":19,"quickness":31}},{"id":289,"team_id":9,"name":"Warren Powers","position":"DL","position_detail":"LE","jersey":145,"face":156,"name_rom_offset":5195,"ability_rom_offset":13430,"team_idx":9,"pos_idx":19,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":50,"pass_interceptions":19,"quickness":31,"jerseyNumber":91,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":50,"pass_interceptions":19,"quickness":31}},{"id":290,"team_id":9,"name":"Karl Mecklenburg","position":"LB","position_detail":"ROLB","jersey":119,"face":27,"name_rom_offset":5208,"ability_rom_offset":13434,"team_idx":9,"pos_idx":20,"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":56,"pass_interceptions":19,"quickness":63,"jerseyNumber":77,"ratings":{"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":56,"pass_interceptions":19,"quickness":63}},{"id":291,"team_id":9,"name":"Michael Brooks","position":"LB","position_detail":"RILB","jersey":86,"face":152,"name_rom_offset":5224,"ability_rom_offset":13438,"team_idx":9,"pos_idx":21,"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":56,"pass_interceptions":19,"quickness":56,"jerseyNumber":56,"ratings":{"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":56,"pass_interceptions":19,"quickness":56}},{"id":292,"team_id":9,"name":"Marc Munford","position":"LB","position_detail":"LILB","jersey":81,"face":65,"name_rom_offset":5238,"ability_rom_offset":13442,"team_idx":9,"pos_idx":22,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":31,"pass_interceptions":19,"quickness":38,"jerseyNumber":51,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":31,"pass_interceptions":19,"quickness":38}},{"id":293,"team_id":9,"name":"Simon Fletcher","position":"LB","position_detail":"LOLB","jersey":115,"face":162,"name_rom_offset":5250,"ability_rom_offset":13446,"team_idx":9,"pos_idx":23,"rushing_power":50,"running_speed":38,"maximum_speed":56,"hitting_power":38,"pass_interceptions":19,"quickness":69,"jerseyNumber":73,"ratings":{"rushing_power":50,"running_speed":38,"maximum_speed":56,"hitting_power":38,"pass_interceptions":19,"quickness":69}},{"id":294,"team_id":9,"name":"Wymon Henderson","position":"DB","position_detail":"RCB","jersey":36,"face":128,"name_rom_offset":5264,"ability_rom_offset":13450,"team_idx":9,"pos_idx":24,"rushing_power":31,"running_speed":25,"maximum_speed":19,"hitting_power":38,"pass_interceptions":38,"quickness":31,"jerseyNumber":24,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":19,"hitting_power":38,"pass_interceptions":38,"quickness":31}},{"id":295,"team_id":9,"name":"Tyrone Braxton","position":"DB","position_detail":"LCB","jersey":52,"face":142,"name_rom_offset":5279,"ability_rom_offset":13454,"team_idx":9,"pos_idx":25,"rushing_power":31,"running_speed":25,"maximum_speed":44,"hitting_power":44,"pass_interceptions":50,"quickness":31,"jerseyNumber":34,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":44,"hitting_power":44,"pass_interceptions":50,"quickness":31}},{"id":296,"team_id":9,"name":"Steve Atwater","position":"DB","position_detail":"FS","jersey":39,"face":193,"name_rom_offset":5293,"ability_rom_offset":13458,"team_idx":9,"pos_idx":26,"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":69,"pass_interceptions":31,"quickness":63,"jerseyNumber":27,"ratings":{"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":69,"pass_interceptions":31,"quickness":63}},{"id":297,"team_id":9,"name":"Dennis Smith","position":"DB","position_detail":"SS","jersey":73,"face":171,"name_rom_offset":5306,"ability_rom_offset":13462,"team_idx":9,"pos_idx":27,"rushing_power":44,"running_speed":38,"maximum_speed":56,"hitting_power":50,"pass_interceptions":44,"quickness":63,"jerseyNumber":49,"ratings":{"rushing_power":44,"running_speed":38,"maximum_speed":56,"hitting_power":50,"pass_interceptions":44,"quickness":63}},{"id":298,"team_id":9,"name":"David Treadwell","position":"K","position_detail":"K","jersey":9,"face":46,"name_rom_offset":5318,"ability_rom_offset":13466,"team_idx":9,"pos_idx":28,"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":69,"avoid_kick_block":31,"jerseyNumber":9,"ratings":{"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":69,"avoid_kick_block":31}},{"id":299,"team_id":9,"name":"Mike Horan","position":"P","position_detail":"P","jersey":2,"face":13,"name_rom_offset":5333,"ability_rom_offset":13470,"team_idx":9,"pos_idx":29,"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":81,"avoid_kick_block":75,"jerseyNumber":2,"ratings":{"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":81,"avoid_kick_block":75}},{"id":300,"team_id":10,"name":"Steve De Berg","position":"QB","position_detail":"QB1","jersey":23,"face":15,"name_rom_offset":5343,"ability_rom_offset":13474,"team_idx":10,"pos_idx":0,"rushing_power":69,"running_speed":25,"maximum_speed":6,"hitting_power":13,"passing_speed":50,"pass_control":63,"accuracy_of_passing":56,"avoid_pass_block":56,"jerseyNumber":17,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":6,"hitting_power":13,"passing_speed":50,"pass_control":63,"accuracy_of_passing":56,"avoid_pass_block":56}},{"id":301,"team_id":10,"name":"Mike Elkins","position":"QB","position_detail":"QB2","jersey":16,"face":64,"name_rom_offset":5356,"ability_rom_offset":13479,"team_idx":10,"pos_idx":1,"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":44,"pass_control":38,"accuracy_of_passing":31,"avoid_pass_block":38,"jerseyNumber":10,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":44,"pass_control":38,"accuracy_of_passing":31,"avoid_pass_block":38}},{"id":302,"team_id":10,"name":"Christian Okoye","position":"RB","position_detail":"RB1","jersey":53,"face":136,"name_rom_offset":5367,"ability_rom_offset":13484,"team_idx":10,"pos_idx":2,"rushing_power":75,"running_speed":63,"maximum_speed":50,"hitting_power":94,"ball_control":50,"receptions":19,"jerseyNumber":35,"ratings":{"rushing_power":75,"running_speed":63,"maximum_speed":50,"hitting_power":94,"ball_control":50,"receptions":19}},{"id":303,"team_id":10,"name":"Barry Word","position":"RB","position_detail":"RB2","jersey":35,"face":210,"name_rom_offset":5382,"ability_rom_offset":13488,"team_idx":10,"pos_idx":3,"rushing_power":69,"running_speed":50,"maximum_speed":31,"hitting_power":75,"ball_control":50,"receptions":19,"jerseyNumber":23,"ratings":{"rushing_power":69,"running_speed":50,"maximum_speed":31,"hitting_power":75,"ball_control":50,"receptions":19}},{"id":304,"team_id":10,"name":"Todd Mcnair","position":"RB","position_detail":"RB3","jersey":72,"face":164,"name_rom_offset":5392,"ability_rom_offset":13492,"team_idx":10,"pos_idx":4,"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":25,"ball_control":50,"receptions":44,"jerseyNumber":48,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":25,"ball_control":50,"receptions":44}},{"id":305,"team_id":10,"name":"Bill Jones","position":"RB","position_detail":"RB4","jersey":67,"face":145,"name_rom_offset":5403,"ability_rom_offset":13496,"team_idx":10,"pos_idx":5,"rushing_power":69,"running_speed":38,"maximum_speed":25,"hitting_power":38,"ball_control":50,"receptions":38,"jerseyNumber":43,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":25,"hitting_power":38,"ball_control":50,"receptions":38}},{"id":306,"team_id":10,"name":"Robb Thomas","position":"WR","position_detail":"WR1","jersey":129,"face":51,"name_rom_offset":5413,"ability_rom_offset":13500,"team_idx":10,"pos_idx":6,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":50,"jerseyNumber":81,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":50}},{"id":307,"team_id":10,"name":"Stephone Paige","position":"WR","position_detail":"WR2","jersey":131,"face":133,"name_rom_offset":5424,"ability_rom_offset":13504,"team_idx":10,"pos_idx":7,"rushing_power":69,"running_speed":38,"maximum_speed":50,"hitting_power":13,"ball_control":50,"receptions":75,"jerseyNumber":83,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":50,"hitting_power":13,"ball_control":50,"receptions":75}},{"id":308,"team_id":10,"name":"J.j. Birden","position":"WR","position_detail":"WR3","jersey":136,"face":158,"name_rom_offset":5438,"ability_rom_offset":13508,"team_idx":10,"pos_idx":8,"rushing_power":69,"running_speed":31,"maximum_speed":38,"hitting_power":13,"ball_control":50,"receptions":44,"jerseyNumber":88,"ratings":{"rushing_power":69,"running_speed":31,"maximum_speed":38,"hitting_power":13,"ball_control":50,"receptions":44}},{"id":309,"team_id":10,"name":"Emile Harry","position":"WR","position_detail":"WR4","jersey":134,"face":203,"name_rom_offset":5449,"ability_rom_offset":13512,"team_idx":10,"pos_idx":9,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":50,"jerseyNumber":86,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":50}},{"id":310,"team_id":10,"name":"Alfredo Roberts","position":"TE","position_detail":"TE1","jersey":135,"face":156,"name_rom_offset":5460,"ability_rom_offset":13516,"team_idx":10,"pos_idx":10,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":50,"ball_control":50,"receptions":31,"jerseyNumber":87,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":50,"ball_control":50,"receptions":31}},{"id":311,"team_id":10,"name":"Jonathan Hayes","position":"TE","position_detail":"TE2","jersey":133,"face":155,"name_rom_offset":5475,"ability_rom_offset":13520,"team_idx":10,"pos_idx":11,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":50,"ball_control":50,"receptions":31,"jerseyNumber":85,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":50,"ball_control":50,"receptions":31}},{"id":312,"team_id":10,"name":"Mike Webster","position":"OL","position_detail":"C","jersey":83,"face":54,"name_rom_offset":5489,"ability_rom_offset":13524,"team_idx":10,"pos_idx":12,"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":69,"jerseyNumber":53,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":69}},{"id":313,"team_id":10,"name":"David Szott","position":"OL","position_detail":"LG","jersey":121,"face":43,"name_rom_offset":5501,"ability_rom_offset":13527,"team_idx":10,"pos_idx":13,"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":50,"jerseyNumber":79,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":50}},{"id":314,"team_id":10,"name":"David Lutz","position":"OL","position_detail":"RG","jersey":114,"face":71,"name_rom_offset":5512,"ability_rom_offset":13530,"team_idx":10,"pos_idx":14,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":56,"jerseyNumber":72,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":56}},{"id":315,"team_id":10,"name":"John Alt","position":"OL","position_detail":"LT","jersey":118,"face":31,"name_rom_offset":5522,"ability_rom_offset":13533,"team_idx":10,"pos_idx":15,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":81,"jerseyNumber":76,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":81}},{"id":316,"team_id":10,"name":"Rich Baldinger","position":"OL","position_detail":"RT","jersey":119,"face":39,"name_rom_offset":5530,"ability_rom_offset":13536,"team_idx":10,"pos_idx":16,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":69,"jerseyNumber":77,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":69}},{"id":317,"team_id":10,"name":"Bill Maas","position":"DL","position_detail":"RE","jersey":99,"face":72,"name_rom_offset":5544,"ability_rom_offset":13539,"team_idx":10,"pos_idx":17,"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":44,"pass_interceptions":19,"quickness":44,"jerseyNumber":63,"ratings":{"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":44,"pass_interceptions":19,"quickness":44}},{"id":318,"team_id":10,"name":"Dan Saleaumua","position":"DL","position_detail":"NT","jersey":151,"face":11,"name_rom_offset":5553,"ability_rom_offset":13543,"team_idx":10,"pos_idx":18,"rushing_power":31,"running_speed":38,"maximum_speed":25,"hitting_power":56,"pass_interceptions":19,"quickness":56,"jerseyNumber":97,"ratings":{"rushing_power":31,"running_speed":38,"maximum_speed":25,"hitting_power":56,"pass_interceptions":19,"quickness":56}},{"id":319,"team_id":10,"name":"Neil Smith","position":"DL","position_detail":"LE","jersey":144,"face":183,"name_rom_offset":5566,"ability_rom_offset":13547,"team_idx":10,"pos_idx":19,"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":63,"pass_interceptions":19,"quickness":56,"jerseyNumber":90,"ratings":{"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":63,"pass_interceptions":19,"quickness":56}},{"id":320,"team_id":10,"name":"Derrick Thomas","position":"LB","position_detail":"ROLB","jersey":88,"face":142,"name_rom_offset":5576,"ability_rom_offset":13551,"team_idx":10,"pos_idx":20,"rushing_power":56,"running_speed":44,"maximum_speed":63,"hitting_power":69,"pass_interceptions":19,"quickness":81,"jerseyNumber":58,"ratings":{"rushing_power":56,"running_speed":44,"maximum_speed":63,"hitting_power":69,"pass_interceptions":19,"quickness":81}},{"id":321,"team_id":10,"name":"Dino Hackett","position":"LB","position_detail":"RILB","jersey":86,"face":67,"name_rom_offset":5590,"ability_rom_offset":13555,"team_idx":10,"pos_idx":21,"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":63,"pass_interceptions":19,"quickness":56,"jerseyNumber":56,"ratings":{"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":63,"pass_interceptions":19,"quickness":56}},{"id":322,"team_id":10,"name":"Percy Snow","position":"LB","position_detail":"LILB","jersey":89,"face":161,"name_rom_offset":5602,"ability_rom_offset":13559,"team_idx":10,"pos_idx":22,"rushing_power":50,"running_speed":38,"maximum_speed":56,"hitting_power":56,"pass_interceptions":31,"quickness":50,"jerseyNumber":59,"ratings":{"rushing_power":50,"running_speed":38,"maximum_speed":56,"hitting_power":56,"pass_interceptions":31,"quickness":50}},{"id":323,"team_id":10,"name":"Chris Martin","position":"LB","position_detail":"LOLB","jersey":87,"face":132,"name_rom_offset":5612,"ability_rom_offset":13563,"team_idx":10,"pos_idx":23,"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":50,"pass_interceptions":19,"quickness":44,"jerseyNumber":57,"ratings":{"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":50,"pass_interceptions":19,"quickness":44}},{"id":324,"team_id":10,"name":"Kevin Ross","position":"DB","position_detail":"RCB","jersey":49,"face":178,"name_rom_offset":5624,"ability_rom_offset":13567,"team_idx":10,"pos_idx":24,"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":44,"pass_interceptions":56,"quickness":44,"jerseyNumber":31,"ratings":{"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":44,"pass_interceptions":56,"quickness":44}},{"id":325,"team_id":10,"name":"Albert Lewis","position":"DB","position_detail":"LCB","jersey":41,"face":134,"name_rom_offset":5634,"ability_rom_offset":13571,"team_idx":10,"pos_idx":25,"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":56,"pass_interceptions":50,"quickness":69,"jerseyNumber":29,"ratings":{"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":56,"pass_interceptions":50,"quickness":69}},{"id":326,"team_id":10,"name":"Deron Cherry","position":"DB","position_detail":"FS","jersey":32,"face":143,"name_rom_offset":5646,"ability_rom_offset":13575,"team_idx":10,"pos_idx":26,"rushing_power":31,"running_speed":25,"maximum_speed":44,"hitting_power":38,"pass_interceptions":50,"quickness":50,"jerseyNumber":20,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":44,"hitting_power":38,"pass_interceptions":50,"quickness":50}},{"id":327,"team_id":10,"name":"Kevin Porter","position":"DB","position_detail":"SS","jersey":39,"face":184,"name_rom_offset":5658,"ability_rom_offset":13579,"team_idx":10,"pos_idx":27,"rushing_power":31,"running_speed":25,"maximum_speed":44,"hitting_power":38,"pass_interceptions":38,"quickness":38,"jerseyNumber":27,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":44,"hitting_power":38,"pass_interceptions":38,"quickness":38}},{"id":328,"team_id":10,"name":"Nick Lowery","position":"K","position_detail":"K","jersey":8,"face":49,"name_rom_offset":5670,"ability_rom_offset":13583,"team_idx":10,"pos_idx":28,"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":81,"avoid_kick_block":81,"jerseyNumber":8,"ratings":{"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":81,"avoid_kick_block":81}},{"id":329,"team_id":10,"name":"Bryan Barker","position":"P","position_detail":"P","jersey":4,"face":9,"name_rom_offset":5681,"ability_rom_offset":13587,"team_idx":10,"pos_idx":29,"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":31,"avoid_kick_block":63,"jerseyNumber":4,"ratings":{"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":31,"avoid_kick_block":63}},{"id":330,"team_id":11,"name":"Jay Schroeder","position":"QB","position_detail":"QB1","jersey":19,"face":17,"name_rom_offset":5693,"ability_rom_offset":13591,"team_idx":11,"pos_idx":0,"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":69,"pass_control":31,"accuracy_of_passing":44,"avoid_pass_block":63,"jerseyNumber":13,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":69,"pass_control":31,"accuracy_of_passing":44,"avoid_pass_block":63}},{"id":331,"team_id":11,"name":"Steve Beuerlein","position":"QB","position_detail":"QB2","jersey":7,"face":16,"name_rom_offset":5706,"ability_rom_offset":13596,"team_idx":11,"pos_idx":1,"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":44,"pass_control":38,"accuracy_of_passing":31,"avoid_pass_block":38,"jerseyNumber":7,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":44,"pass_control":38,"accuracy_of_passing":31,"avoid_pass_block":38}},{"id":332,"team_id":11,"name":"Bo Jackson","position":"RB","position_detail":"RB1","jersey":52,"face":154,"name_rom_offset":5721,"ability_rom_offset":13601,"team_idx":11,"pos_idx":2,"rushing_power":69,"running_speed":38,"maximum_speed":75,"hitting_power":31,"ball_control":81,"receptions":19,"jerseyNumber":34,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":75,"hitting_power":31,"ball_control":81,"receptions":19}},{"id":333,"team_id":11,"name":"Marcus Allen","position":"RB","position_detail":"RB2","jersey":50,"face":139,"name_rom_offset":5731,"ability_rom_offset":13605,"team_idx":11,"pos_idx":3,"rushing_power":69,"running_speed":38,"maximum_speed":56,"hitting_power":25,"ball_control":50,"receptions":31,"jerseyNumber":32,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":56,"hitting_power":25,"ball_control":50,"receptions":31}},{"id":334,"team_id":11,"name":"Steve Smith","position":"RB","position_detail":"RB3","jersey":53,"face":141,"name_rom_offset":5743,"ability_rom_offset":13609,"team_idx":11,"pos_idx":4,"rushing_power":69,"running_speed":44,"maximum_speed":25,"hitting_power":50,"ball_control":50,"receptions":31,"jerseyNumber":35,"ratings":{"rushing_power":69,"running_speed":44,"maximum_speed":25,"hitting_power":50,"ball_control":50,"receptions":31}},{"id":335,"team_id":11,"name":"Greg Bell","position":"RB","position_detail":"RB4","jersey":40,"face":166,"name_rom_offset":5754,"ability_rom_offset":13613,"team_idx":11,"pos_idx":5,"rushing_power":69,"running_speed":44,"maximum_speed":31,"hitting_power":38,"ball_control":50,"receptions":19,"jerseyNumber":28,"ratings":{"rushing_power":69,"running_speed":44,"maximum_speed":31,"hitting_power":38,"ball_control":50,"receptions":19}},{"id":336,"team_id":11,"name":"Mervyn Fernandez","position":"WR","position_detail":"WR1","jersey":134,"face":134,"name_rom_offset":5763,"ability_rom_offset":13617,"team_idx":11,"pos_idx":6,"rushing_power":69,"running_speed":38,"maximum_speed":50,"hitting_power":13,"ball_control":63,"receptions":63,"jerseyNumber":86,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":50,"hitting_power":13,"ball_control":63,"receptions":63}},{"id":337,"team_id":11,"name":"Willie Gault","position":"WR","position_detail":"WR2","jersey":131,"face":132,"name_rom_offset":5779,"ability_rom_offset":13621,"team_idx":11,"pos_idx":7,"rushing_power":69,"running_speed":44,"maximum_speed":63,"hitting_power":13,"ball_control":50,"receptions":56,"jerseyNumber":83,"ratings":{"rushing_power":69,"running_speed":44,"maximum_speed":63,"hitting_power":13,"ball_control":50,"receptions":56}},{"id":338,"team_id":11,"name":"Tim Brown","position":"WR","position_detail":"WR3","jersey":129,"face":176,"name_rom_offset":5791,"ability_rom_offset":13625,"team_idx":11,"pos_idx":8,"rushing_power":69,"running_speed":44,"maximum_speed":56,"hitting_power":13,"ball_control":50,"receptions":50,"jerseyNumber":81,"ratings":{"rushing_power":69,"running_speed":44,"maximum_speed":56,"hitting_power":13,"ball_control":50,"receptions":50}},{"id":339,"team_id":11,"name":"Sam Graddy","position":"WR","position_detail":"WR4","jersey":133,"face":203,"name_rom_offset":5800,"ability_rom_offset":13629,"team_idx":11,"pos_idx":9,"rushing_power":69,"running_speed":44,"maximum_speed":63,"hitting_power":13,"ball_control":50,"receptions":19,"jerseyNumber":85,"ratings":{"rushing_power":69,"running_speed":44,"maximum_speed":63,"hitting_power":13,"ball_control":50,"receptions":19}},{"id":340,"team_id":11,"name":"Ethan Horton","position":"TE","position_detail":"TE1","jersey":136,"face":192,"name_rom_offset":5810,"ability_rom_offset":13633,"team_idx":11,"pos_idx":10,"rushing_power":69,"running_speed":25,"maximum_speed":44,"hitting_power":50,"ball_control":50,"receptions":44,"jerseyNumber":88,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":44,"hitting_power":50,"ball_control":50,"receptions":44}},{"id":341,"team_id":11,"name":"Mike Dyal","position":"TE","position_detail":"TE2","jersey":132,"face":30,"name_rom_offset":5822,"ability_rom_offset":13637,"team_idx":11,"pos_idx":11,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":38,"ball_control":50,"receptions":25,"jerseyNumber":84,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":38,"ball_control":50,"receptions":25}},{"id":342,"team_id":11,"name":"Don Mosebar","position":"OL","position_detail":"C","jersey":114,"face":31,"name_rom_offset":5831,"ability_rom_offset":13641,"team_idx":11,"pos_idx":12,"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":50,"jerseyNumber":72,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":50}},{"id":343,"team_id":11,"name":"Steve Wisniewski","position":"OL","position_detail":"LG","jersey":118,"face":50,"name_rom_offset":5842,"ability_rom_offset":13644,"team_idx":11,"pos_idx":13,"rushing_power":69,"running_speed":25,"maximum_speed":44,"hitting_power":69,"jerseyNumber":76,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":44,"hitting_power":69}},{"id":344,"team_id":11,"name":"Max Montoya","position":"OL","position_detail":"RG","jersey":101,"face":36,"name_rom_offset":5858,"ability_rom_offset":13647,"team_idx":11,"pos_idx":14,"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":56,"jerseyNumber":65,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":56}},{"id":345,"team_id":11,"name":"Bruce Wilkerson","position":"OL","position_detail":"LT","jersey":104,"face":201,"name_rom_offset":5869,"ability_rom_offset":13650,"team_idx":11,"pos_idx":15,"rushing_power":69,"running_speed":25,"maximum_speed":50,"hitting_power":50,"jerseyNumber":68,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":50,"hitting_power":50}},{"id":346,"team_id":11,"name":"Rory Graves","position":"OL","position_detail":"RT","jersey":96,"face":153,"name_rom_offset":5884,"ability_rom_offset":13653,"team_idx":11,"pos_idx":16,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":50,"jerseyNumber":60,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":50}},{"id":347,"team_id":11,"name":"Greg Townsend","position":"DL","position_detail":"RE","jersey":147,"face":147,"name_rom_offset":5895,"ability_rom_offset":13656,"team_idx":11,"pos_idx":17,"rushing_power":50,"running_speed":38,"maximum_speed":56,"hitting_power":63,"pass_interceptions":31,"quickness":69,"jerseyNumber":93,"ratings":{"rushing_power":50,"running_speed":38,"maximum_speed":56,"hitting_power":63,"pass_interceptions":31,"quickness":69}},{"id":348,"team_id":11,"name":"Bob Golic","position":"DL","position_detail":"NT","jersey":121,"face":73,"name_rom_offset":5908,"ability_rom_offset":13660,"team_idx":11,"pos_idx":18,"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":69,"pass_interceptions":25,"quickness":56,"jerseyNumber":79,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":69,"pass_interceptions":25,"quickness":56}},{"id":349,"team_id":11,"name":"Howie Long","position":"DL","position_detail":"LE","jersey":117,"face":79,"name_rom_offset":5917,"ability_rom_offset":13664,"team_idx":11,"pos_idx":19,"rushing_power":50,"running_speed":38,"maximum_speed":56,"hitting_power":69,"pass_interceptions":31,"quickness":69,"jerseyNumber":75,"ratings":{"rushing_power":50,"running_speed":38,"maximum_speed":56,"hitting_power":69,"pass_interceptions":31,"quickness":69}},{"id":350,"team_id":11,"name":"Aaron Wallace","position":"LB","position_detail":"ROLB","jersey":81,"face":150,"name_rom_offset":5927,"ability_rom_offset":13668,"team_idx":11,"pos_idx":20,"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":38,"pass_interceptions":19,"quickness":25,"jerseyNumber":51,"ratings":{"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":38,"pass_interceptions":19,"quickness":25}},{"id":351,"team_id":11,"name":"Scott Davis","position":"LB","position_detail":"RILB","jersey":112,"face":39,"name_rom_offset":5940,"ability_rom_offset":13672,"team_idx":11,"pos_idx":21,"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":63,"pass_interceptions":25,"quickness":63,"jerseyNumber":70,"ratings":{"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":63,"pass_interceptions":25,"quickness":63}},{"id":352,"team_id":11,"name":"Riki Ellison","position":"LB","position_detail":"LILB","jersey":80,"face":38,"name_rom_offset":5951,"ability_rom_offset":13676,"team_idx":11,"pos_idx":22,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":44,"quickness":25,"jerseyNumber":50,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":44,"quickness":25}},{"id":353,"team_id":11,"name":"Jerry Robinson","position":"LB","position_detail":"LOLB","jersey":87,"face":138,"name_rom_offset":5963,"ability_rom_offset":13680,"team_idx":11,"pos_idx":23,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":44,"quickness":25,"jerseyNumber":57,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":44,"quickness":25}},{"id":354,"team_id":11,"name":"L. Washington","position":"DB","position_detail":"RCB","jersey":72,"face":155,"name_rom_offset":5977,"ability_rom_offset":13684,"team_idx":11,"pos_idx":24,"rushing_power":44,"running_speed":38,"maximum_speed":56,"hitting_power":44,"pass_interceptions":38,"quickness":50,"jerseyNumber":48,"ratings":{"rushing_power":44,"running_speed":38,"maximum_speed":56,"hitting_power":44,"pass_interceptions":38,"quickness":50}},{"id":355,"team_id":11,"name":"Terry Mcdaniel","position":"DB","position_detail":"LCB","jersey":54,"face":202,"name_rom_offset":5990,"ability_rom_offset":13688,"team_idx":11,"pos_idx":25,"rushing_power":44,"running_speed":38,"maximum_speed":56,"hitting_power":44,"pass_interceptions":38,"quickness":50,"jerseyNumber":36,"ratings":{"rushing_power":44,"running_speed":38,"maximum_speed":56,"hitting_power":44,"pass_interceptions":38,"quickness":50}},{"id":356,"team_id":11,"name":"Eddie Anderson","position":"DB","position_detail":"FS","jersey":51,"face":173,"name_rom_offset":6004,"ability_rom_offset":13692,"team_idx":11,"pos_idx":26,"rushing_power":50,"running_speed":38,"maximum_speed":63,"hitting_power":69,"pass_interceptions":50,"quickness":63,"jerseyNumber":33,"ratings":{"rushing_power":50,"running_speed":38,"maximum_speed":63,"hitting_power":69,"pass_interceptions":50,"quickness":63}},{"id":357,"team_id":11,"name":"Mike Harden","position":"DB","position_detail":"SS","jersey":69,"face":198,"name_rom_offset":6018,"ability_rom_offset":13696,"team_idx":11,"pos_idx":27,"rushing_power":31,"running_speed":25,"maximum_speed":44,"hitting_power":50,"pass_interceptions":50,"quickness":50,"jerseyNumber":45,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":44,"hitting_power":50,"pass_interceptions":50,"quickness":50}},{"id":358,"team_id":11,"name":"Jeff Jaeger","position":"K","position_detail":"K","jersey":24,"face":23,"name_rom_offset":6029,"ability_rom_offset":13700,"team_idx":11,"pos_idx":28,"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":56,"avoid_kick_block":56,"jerseyNumber":18,"ratings":{"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":56,"avoid_kick_block":56}},{"id":359,"team_id":11,"name":"Jeff Gossett","position":"P","position_detail":"P","jersey":6,"face":27,"name_rom_offset":6040,"ability_rom_offset":13704,"team_idx":11,"pos_idx":29,"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":31,"avoid_kick_block":38,"jerseyNumber":6,"ratings":{"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":31,"avoid_kick_block":38}},{"id":360,"team_id":12,"name":"B.j. Tolliver","position":"QB","position_detail":"QB1","jersey":17,"face":19,"name_rom_offset":6052,"ability_rom_offset":13708,"team_idx":12,"pos_idx":0,"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":81,"pass_control":31,"accuracy_of_passing":31,"avoid_pass_block":44,"jerseyNumber":11,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":81,"pass_control":31,"accuracy_of_passing":31,"avoid_pass_block":44}},{"id":361,"team_id":12,"name":"Mark Vlasic","position":"QB","position_detail":"QB2","jersey":19,"face":49,"name_rom_offset":6065,"ability_rom_offset":13713,"team_idx":12,"pos_idx":1,"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":44,"pass_control":38,"accuracy_of_passing":25,"avoid_pass_block":38,"jerseyNumber":13,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":44,"pass_control":38,"accuracy_of_passing":25,"avoid_pass_block":38}},{"id":362,"team_id":12,"name":"Marion Butts","position":"RB","position_detail":"RB1","jersey":53,"face":144,"name_rom_offset":6076,"ability_rom_offset":13718,"team_idx":12,"pos_idx":2,"rushing_power":69,"running_speed":38,"maximum_speed":63,"hitting_power":38,"ball_control":50,"receptions":25,"jerseyNumber":35,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":63,"hitting_power":38,"ball_control":50,"receptions":25}},{"id":363,"team_id":12,"name":"Rod Bernstine","position":"RB","position_detail":"RB2","jersey":130,"face":130,"name_rom_offset":6088,"ability_rom_offset":13722,"team_idx":12,"pos_idx":3,"rushing_power":69,"running_speed":44,"maximum_speed":25,"hitting_power":44,"ball_control":50,"receptions":19,"jerseyNumber":82,"ratings":{"rushing_power":69,"running_speed":44,"maximum_speed":25,"hitting_power":44,"ball_control":50,"receptions":19}},{"id":364,"team_id":12,"name":"Joe Caravello","position":"RB","position_detail":"RB3","jersey":70,"face":20,"name_rom_offset":6101,"ability_rom_offset":13726,"team_idx":12,"pos_idx":4,"rushing_power":69,"running_speed":38,"maximum_speed":25,"hitting_power":44,"ball_control":50,"receptions":25,"jerseyNumber":46,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":25,"hitting_power":44,"ball_control":50,"receptions":25}},{"id":365,"team_id":12,"name":"Ronnie Harmon","position":"RB","position_detail":"RB4","jersey":51,"face":188,"name_rom_offset":6114,"ability_rom_offset":13730,"team_idx":12,"pos_idx":5,"rushing_power":69,"running_speed":38,"maximum_speed":31,"hitting_power":25,"ball_control":50,"receptions":50,"jerseyNumber":33,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":31,"hitting_power":25,"ball_control":50,"receptions":50}},{"id":366,"team_id":12,"name":"Quinn Early","position":"WR","position_detail":"WR1","jersey":135,"face":170,"name_rom_offset":6127,"ability_rom_offset":13734,"team_idx":12,"pos_idx":6,"rushing_power":69,"running_speed":31,"maximum_speed":31,"hitting_power":13,"ball_control":50,"receptions":44,"jerseyNumber":87,"ratings":{"rushing_power":69,"running_speed":31,"maximum_speed":31,"hitting_power":13,"ball_control":50,"receptions":44}},{"id":367,"team_id":12,"name":"Anthony Miller","position":"WR","position_detail":"WR2","jersey":131,"face":151,"name_rom_offset":6138,"ability_rom_offset":13738,"team_idx":12,"pos_idx":7,"rushing_power":69,"running_speed":38,"maximum_speed":44,"hitting_power":13,"ball_control":50,"receptions":69,"jerseyNumber":83,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":44,"hitting_power":13,"ball_control":50,"receptions":69}},{"id":368,"team_id":12,"name":"Nate Lewis","position":"WR","position_detail":"WR3","jersey":129,"face":176,"name_rom_offset":6152,"ability_rom_offset":13742,"team_idx":12,"pos_idx":8,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":44,"jerseyNumber":81,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":44}},{"id":369,"team_id":12,"name":"Wayne Walker","position":"WR","position_detail":"WR4","jersey":128,"face":137,"name_rom_offset":6162,"ability_rom_offset":13746,"team_idx":12,"pos_idx":9,"rushing_power":69,"running_speed":31,"maximum_speed":31,"hitting_power":13,"ball_control":50,"receptions":44,"jerseyNumber":80,"ratings":{"rushing_power":69,"running_speed":31,"maximum_speed":31,"hitting_power":13,"ball_control":50,"receptions":44}},{"id":370,"team_id":12,"name":"Derrick Walker","position":"TE","position_detail":"TE1","jersey":137,"face":132,"name_rom_offset":6174,"ability_rom_offset":13750,"team_idx":12,"pos_idx":10,"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":50,"ball_control":50,"receptions":38,"jerseyNumber":89,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":50,"ball_control":50,"receptions":38}},{"id":371,"team_id":12,"name":"Arthur Cox","position":"TE","position_detail":"TE2","jersey":136,"face":161,"name_rom_offset":6188,"ability_rom_offset":13754,"team_idx":12,"pos_idx":11,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":63,"ball_control":50,"receptions":31,"jerseyNumber":88,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":63,"ball_control":50,"receptions":31}},{"id":372,"team_id":12,"name":"Frank Cornish","position":"OL","position_detail":"C","jersey":99,"face":143,"name_rom_offset":6198,"ability_rom_offset":13758,"team_idx":12,"pos_idx":12,"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":56,"jerseyNumber":63,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":56}},{"id":373,"team_id":12,"name":"Courtney Hall","position":"OL","position_detail":"LG","jersey":83,"face":173,"name_rom_offset":6211,"ability_rom_offset":13761,"team_idx":12,"pos_idx":13,"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":50,"jerseyNumber":53,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":50}},{"id":374,"team_id":12,"name":"David Richards","position":"OL","position_detail":"RG","jersey":101,"face":29,"name_rom_offset":6224,"ability_rom_offset":13764,"team_idx":12,"pos_idx":14,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":69,"jerseyNumber":65,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":69}},{"id":375,"team_id":12,"name":"Joel Patten","position":"OL","position_detail":"LT","jersey":120,"face":48,"name_rom_offset":6238,"ability_rom_offset":13767,"team_idx":12,"pos_idx":15,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":63,"jerseyNumber":78,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":63}},{"id":376,"team_id":12,"name":"B. Thompson","position":"OL","position_detail":"RT","jersey":118,"face":199,"name_rom_offset":6249,"ability_rom_offset":13770,"team_idx":12,"pos_idx":16,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":56,"jerseyNumber":76,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":56}},{"id":377,"team_id":12,"name":"Burt Grossman","position":"DL","position_detail":"RE","jersey":146,"face":30,"name_rom_offset":6260,"ability_rom_offset":13773,"team_idx":12,"pos_idx":17,"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":50,"pass_interceptions":19,"quickness":63,"jerseyNumber":92,"ratings":{"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":50,"pass_interceptions":19,"quickness":63}},{"id":378,"team_id":12,"name":"Les Miller","position":"DL","position_detail":"NT","jersey":105,"face":79,"name_rom_offset":6273,"ability_rom_offset":13777,"team_idx":12,"pos_idx":18,"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":56,"pass_interceptions":19,"quickness":44,"jerseyNumber":69,"ratings":{"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":56,"pass_interceptions":19,"quickness":44}},{"id":379,"team_id":12,"name":"Lee Williams","position":"DL","position_detail":"LE","jersey":153,"face":183,"name_rom_offset":6283,"ability_rom_offset":13781,"team_idx":12,"pos_idx":19,"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":56,"pass_interceptions":19,"quickness":56,"jerseyNumber":99,"ratings":{"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":56,"pass_interceptions":19,"quickness":56}},{"id":380,"team_id":12,"name":"Leslie O.Neal","position":"LB","position_detail":"ROLB","jersey":145,"face":162,"name_rom_offset":6295,"ability_rom_offset":13785,"team_idx":12,"pos_idx":20,"rushing_power":50,"running_speed":38,"maximum_speed":56,"hitting_power":63,"pass_interceptions":19,"quickness":69,"jerseyNumber":91,"ratings":{"rushing_power":50,"running_speed":38,"maximum_speed":56,"hitting_power":63,"pass_interceptions":19,"quickness":69}},{"id":381,"team_id":12,"name":"Junior Seau","position":"LB","position_detail":"RILB","jersey":85,"face":158,"name_rom_offset":6308,"ability_rom_offset":13789,"team_idx":12,"pos_idx":21,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":44,"pass_interceptions":19,"quickness":38,"jerseyNumber":55,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":44,"pass_interceptions":19,"quickness":38}},{"id":382,"team_id":12,"name":"Gary Plummer","position":"LB","position_detail":"LILB","jersey":80,"face":36,"name_rom_offset":6319,"ability_rom_offset":13793,"team_idx":12,"pos_idx":22,"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":69,"pass_interceptions":19,"quickness":44,"jerseyNumber":50,"ratings":{"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":69,"pass_interceptions":19,"quickness":44}},{"id":383,"team_id":12,"name":"Henry Rolling","position":"LB","position_detail":"LOLB","jersey":87,"face":128,"name_rom_offset":6331,"ability_rom_offset":13797,"team_idx":12,"pos_idx":23,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":31,"quickness":50,"jerseyNumber":57,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":31,"quickness":50}},{"id":384,"team_id":12,"name":"Sam Seale","position":"DB","position_detail":"RCB","jersey":48,"face":147,"name_rom_offset":6344,"ability_rom_offset":13801,"team_idx":12,"pos_idx":24,"rushing_power":44,"running_speed":38,"maximum_speed":56,"hitting_power":38,"pass_interceptions":50,"quickness":44,"jerseyNumber":30,"ratings":{"rushing_power":44,"running_speed":38,"maximum_speed":56,"hitting_power":38,"pass_interceptions":50,"quickness":44}},{"id":385,"team_id":12,"name":"Gill Byrd","position":"DB","position_detail":"LCB","jersey":34,"face":203,"name_rom_offset":6353,"ability_rom_offset":13805,"team_idx":12,"pos_idx":25,"rushing_power":50,"running_speed":38,"maximum_speed":63,"hitting_power":50,"pass_interceptions":69,"quickness":75,"jerseyNumber":22,"ratings":{"rushing_power":50,"running_speed":38,"maximum_speed":63,"hitting_power":50,"pass_interceptions":69,"quickness":75}},{"id":386,"team_id":12,"name":"Vencie Glenn","position":"DB","position_detail":"FS","jersey":37,"face":142,"name_rom_offset":6362,"ability_rom_offset":13809,"team_idx":12,"pos_idx":26,"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":44,"pass_interceptions":44,"quickness":44,"jerseyNumber":25,"ratings":{"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":44,"pass_interceptions":44,"quickness":44}},{"id":387,"team_id":12,"name":"Martin Bayless","position":"DB","position_detail":"SS","jersey":68,"face":198,"name_rom_offset":6374,"ability_rom_offset":13813,"team_idx":12,"pos_idx":27,"rushing_power":31,"running_speed":25,"maximum_speed":44,"hitting_power":56,"pass_interceptions":44,"quickness":44,"jerseyNumber":44,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":44,"hitting_power":56,"pass_interceptions":44,"quickness":44}},{"id":388,"team_id":12,"name":"John Carney","position":"K","position_detail":"K","jersey":3,"face":30,"name_rom_offset":6388,"ability_rom_offset":13817,"team_idx":12,"pos_idx":28,"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":75,"avoid_kick_block":50,"jerseyNumber":3,"ratings":{"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":75,"avoid_kick_block":50}},{"id":389,"team_id":12,"name":"John Kidd","position":"P","position_detail":"P","jersey":16,"face":64,"name_rom_offset":6399,"ability_rom_offset":13821,"team_idx":12,"pos_idx":29,"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":69,"avoid_kick_block":56,"jerseyNumber":10,"ratings":{"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":69,"avoid_kick_block":56}},{"id":390,"team_id":13,"name":"Dave Krieg","position":"QB","position_detail":"QB1","jersey":23,"face":23,"name_rom_offset":6408,"ability_rom_offset":13825,"team_idx":13,"pos_idx":0,"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":25,"pass_control":69,"accuracy_of_passing":69,"avoid_pass_block":69,"jerseyNumber":17,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":25,"pass_control":69,"accuracy_of_passing":69,"avoid_pass_block":69}},{"id":391,"team_id":13,"name":"Kelly Stouffer","position":"QB","position_detail":"QB2","jersey":17,"face":18,"name_rom_offset":6418,"ability_rom_offset":13830,"team_idx":13,"pos_idx":1,"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":44,"pass_control":38,"accuracy_of_passing":38,"avoid_pass_block":38,"jerseyNumber":11,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":44,"pass_control":38,"accuracy_of_passing":38,"avoid_pass_block":38}},{"id":392,"team_id":13,"name":"John L. Williams","position":"RB","position_detail":"RB1","jersey":50,"face":145,"name_rom_offset":6432,"ability_rom_offset":13835,"team_idx":13,"pos_idx":2,"rushing_power":69,"running_speed":44,"maximum_speed":25,"hitting_power":38,"ball_control":50,"receptions":63,"jerseyNumber":32,"ratings":{"rushing_power":69,"running_speed":44,"maximum_speed":25,"hitting_power":38,"ball_control":50,"receptions":63}},{"id":393,"team_id":13,"name":"Derrick Fenner","position":"RB","position_detail":"RB2","jersey":68,"face":146,"name_rom_offset":6448,"ability_rom_offset":13839,"team_idx":13,"pos_idx":3,"rushing_power":69,"running_speed":56,"maximum_speed":25,"hitting_power":75,"ball_control":50,"receptions":25,"jerseyNumber":44,"ratings":{"rushing_power":69,"running_speed":56,"maximum_speed":25,"hitting_power":75,"ball_control":50,"receptions":25}},{"id":394,"team_id":13,"name":"James Jones","position":"RB","position_detail":"RB3","jersey":48,"face":162,"name_rom_offset":6462,"ability_rom_offset":13843,"team_idx":13,"pos_idx":4,"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":31,"ball_control":50,"receptions":25,"jerseyNumber":30,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":31,"ball_control":50,"receptions":25}},{"id":395,"team_id":13,"name":"Chris Warren","position":"RB","position_detail":"RB4","jersey":66,"face":193,"name_rom_offset":6473,"ability_rom_offset":13847,"team_idx":13,"pos_idx":5,"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":31,"ball_control":50,"receptions":25,"jerseyNumber":42,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":31,"ball_control":50,"receptions":25}},{"id":396,"team_id":13,"name":"Brian Blades","position":"WR","position_detail":"WR1","jersey":137,"face":152,"name_rom_offset":6485,"ability_rom_offset":13851,"team_idx":13,"pos_idx":6,"rushing_power":69,"running_speed":31,"maximum_speed":31,"hitting_power":13,"ball_control":50,"receptions":50,"jerseyNumber":89,"ratings":{"rushing_power":69,"running_speed":31,"maximum_speed":31,"hitting_power":13,"ball_control":50,"receptions":50}},{"id":397,"team_id":13,"name":"Tommy Kane","position":"WR","position_detail":"WR2","jersey":129,"face":155,"name_rom_offset":6497,"ability_rom_offset":13855,"team_idx":13,"pos_idx":7,"rushing_power":69,"running_speed":31,"maximum_speed":38,"hitting_power":13,"ball_control":50,"receptions":56,"jerseyNumber":81,"ratings":{"rushing_power":69,"running_speed":31,"maximum_speed":38,"hitting_power":13,"ball_control":50,"receptions":56}},{"id":398,"team_id":13,"name":"Paul Skansi","position":"WR","position_detail":"WR3","jersey":130,"face":3,"name_rom_offset":6507,"ability_rom_offset":13859,"team_idx":13,"pos_idx":8,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":44,"jerseyNumber":82,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":44}},{"id":399,"team_id":13,"name":"Jeff Chadwick","position":"WR","position_detail":"WR4","jersey":136,"face":52,"name_rom_offset":6518,"ability_rom_offset":13863,"team_idx":13,"pos_idx":9,"rushing_power":69,"running_speed":31,"maximum_speed":38,"hitting_power":13,"ball_control":50,"receptions":44,"jerseyNumber":88,"ratings":{"rushing_power":69,"running_speed":31,"maximum_speed":38,"hitting_power":13,"ball_control":50,"receptions":44}},{"id":400,"team_id":13,"name":"Ron Heller","position":"TE","position_detail":"TE1","jersey":133,"face":33,"name_rom_offset":6531,"ability_rom_offset":13867,"team_idx":13,"pos_idx":10,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":44,"ball_control":50,"receptions":31,"jerseyNumber":85,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":44,"ball_control":50,"receptions":31}},{"id":401,"team_id":13,"name":"Travis Mcneal","position":"TE","position_detail":"TE2","jersey":134,"face":167,"name_rom_offset":6541,"ability_rom_offset":13871,"team_idx":13,"pos_idx":11,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":44,"ball_control":50,"receptions":31,"jerseyNumber":86,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":44,"ball_control":50,"receptions":31}},{"id":402,"team_id":13,"name":"Grant Feasel","position":"OL","position_detail":"C","jersey":84,"face":27,"name_rom_offset":6554,"ability_rom_offset":13875,"team_idx":13,"pos_idx":12,"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":56,"jerseyNumber":54,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":56}},{"id":403,"team_id":13,"name":"Edwin Bailey","position":"OL","position_detail":"LG","jersey":101,"face":149,"name_rom_offset":6566,"ability_rom_offset":13878,"team_idx":13,"pos_idx":13,"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":44,"jerseyNumber":65,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":44}},{"id":404,"team_id":13,"name":"Bryan Millard","position":"OL","position_detail":"RG","jersey":113,"face":75,"name_rom_offset":6578,"ability_rom_offset":13881,"team_idx":13,"pos_idx":14,"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":50,"jerseyNumber":71,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":50}},{"id":405,"team_id":13,"name":"Andy Heck","position":"OL","position_detail":"LT","jersey":102,"face":43,"name_rom_offset":6591,"ability_rom_offset":13884,"team_idx":13,"pos_idx":15,"rushing_power":69,"running_speed":25,"maximum_speed":44,"hitting_power":50,"jerseyNumber":66,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":44,"hitting_power":50}},{"id":406,"team_id":13,"name":"Ron Mattes","position":"OL","position_detail":"RT","jersey":112,"face":50,"name_rom_offset":6600,"ability_rom_offset":13887,"team_idx":13,"pos_idx":16,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":56,"jerseyNumber":70,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":56}},{"id":407,"team_id":13,"name":"Tony Woods","position":"DL","position_detail":"RE","jersey":87,"face":165,"name_rom_offset":6610,"ability_rom_offset":13890,"team_idx":13,"pos_idx":17,"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":50,"pass_interceptions":19,"quickness":56,"jerseyNumber":57,"ratings":{"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":50,"pass_interceptions":19,"quickness":56}},{"id":408,"team_id":13,"name":"Joe Nash","position":"DL","position_detail":"NT","jersey":114,"face":81,"name_rom_offset":6620,"ability_rom_offset":13894,"team_idx":13,"pos_idx":18,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":44,"pass_interceptions":19,"quickness":31,"jerseyNumber":72,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":44,"pass_interceptions":19,"quickness":31}},{"id":409,"team_id":13,"name":"Jacob Green","position":"DL","position_detail":"LE","jersey":121,"face":137,"name_rom_offset":6628,"ability_rom_offset":13898,"team_idx":13,"pos_idx":19,"rushing_power":50,"running_speed":38,"maximum_speed":63,"hitting_power":56,"pass_interceptions":19,"quickness":69,"jerseyNumber":79,"ratings":{"rushing_power":50,"running_speed":38,"maximum_speed":63,"hitting_power":56,"pass_interceptions":19,"quickness":69}},{"id":410,"team_id":13,"name":"Rufus Porter","position":"LB","position_detail":"ROLB","jersey":151,"face":129,"name_rom_offset":6639,"ability_rom_offset":13902,"team_idx":13,"pos_idx":20,"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":44,"pass_interceptions":19,"quickness":56,"jerseyNumber":97,"ratings":{"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":44,"pass_interceptions":19,"quickness":56}},{"id":411,"team_id":13,"name":"Cortez Kennedy","position":"LB","position_detail":"RILB","jersey":150,"face":156,"name_rom_offset":6651,"ability_rom_offset":13906,"team_idx":13,"pos_idx":21,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":56,"pass_interceptions":19,"quickness":44,"jerseyNumber":96,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":56,"pass_interceptions":19,"quickness":44}},{"id":412,"team_id":13,"name":"David Wyman","position":"LB","position_detail":"LILB","jersey":146,"face":19,"name_rom_offset":6665,"ability_rom_offset":13910,"team_idx":13,"pos_idx":22,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":19,"quickness":38,"jerseyNumber":92,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":19,"quickness":38}},{"id":413,"team_id":13,"name":"Terry Wooden","position":"LB","position_detail":"LOLB","jersey":81,"face":192,"name_rom_offset":6676,"ability_rom_offset":13914,"team_idx":13,"pos_idx":23,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":19,"quickness":25,"jerseyNumber":51,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":19,"quickness":25}},{"id":414,"team_id":13,"name":"Patrick Hunter","position":"DB","position_detail":"RCB","jersey":39,"face":146,"name_rom_offset":6688,"ability_rom_offset":13918,"team_idx":13,"pos_idx":24,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":38,"quickness":44,"jerseyNumber":27,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":38,"quickness":44}},{"id":415,"team_id":13,"name":"Dwayne Harper","position":"DB","position_detail":"LCB","jersey":41,"face":150,"name_rom_offset":6702,"ability_rom_offset":13922,"team_idx":13,"pos_idx":25,"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":31,"pass_interceptions":50,"quickness":50,"jerseyNumber":29,"ratings":{"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":31,"pass_interceptions":50,"quickness":50}},{"id":416,"team_id":13,"name":"Eugene Robinson","position":"DB","position_detail":"FS","jersey":65,"face":201,"name_rom_offset":6715,"ability_rom_offset":13926,"team_idx":13,"pos_idx":26,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":50,"quickness":38,"jerseyNumber":41,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":50,"quickness":38}},{"id":417,"team_id":13,"name":"Nesby Glasgow","position":"DB","position_detail":"SS","jersey":34,"face":141,"name_rom_offset":6730,"ability_rom_offset":13930,"team_idx":13,"pos_idx":27,"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":56,"pass_interceptions":25,"quickness":56,"jerseyNumber":22,"ratings":{"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":56,"pass_interceptions":25,"quickness":56}},{"id":418,"team_id":13,"name":"Norm Johnson","position":"K","position_detail":"K","jersey":9,"face":42,"name_rom_offset":6743,"ability_rom_offset":13934,"team_idx":13,"pos_idx":28,"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":44,"avoid_kick_block":38,"jerseyNumber":9,"ratings":{"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":44,"avoid_kick_block":38}},{"id":419,"team_id":13,"name":"Rick Donnelly","position":"P","position_detail":"P","jersey":3,"face":54,"name_rom_offset":6755,"ability_rom_offset":13938,"team_idx":13,"pos_idx":29,"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":44,"avoid_kick_block":63,"jerseyNumber":3,"ratings":{"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":44,"avoid_kick_block":63}},{"id":420,"team_id":14,"name":"Mark Rypien","position":"QB","position_detail":"QB1","jersey":17,"face":33,"name_rom_offset":6768,"ability_rom_offset":13942,"team_idx":14,"pos_idx":0,"rushing_power":69,"running_speed":25,"maximum_speed":6,"hitting_power":13,"passing_speed":38,"pass_control":44,"accuracy_of_passing":44,"avoid_pass_block":38,"jerseyNumber":11,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":6,"hitting_power":13,"passing_speed":38,"pass_control":44,"accuracy_of_passing":44,"avoid_pass_block":38}},{"id":421,"team_id":14,"name":"Stan Humphries","position":"QB","position_detail":"QB2","jersey":22,"face":31,"name_rom_offset":6779,"ability_rom_offset":13947,"team_idx":14,"pos_idx":1,"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":44,"pass_control":38,"accuracy_of_passing":31,"avoid_pass_block":38,"jerseyNumber":16,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":44,"pass_control":38,"accuracy_of_passing":31,"avoid_pass_block":38}},{"id":422,"team_id":14,"name":"Earnest Byner","position":"RB","position_detail":"RB1","jersey":33,"face":162,"name_rom_offset":6793,"ability_rom_offset":13952,"team_idx":14,"pos_idx":2,"rushing_power":69,"running_speed":38,"maximum_speed":50,"hitting_power":25,"ball_control":81,"receptions":38,"jerseyNumber":21,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":50,"hitting_power":25,"ball_control":81,"receptions":38}},{"id":423,"team_id":14,"name":"Ricky Sanders","position":"RB","position_detail":"RB2","jersey":131,"face":197,"name_rom_offset":6806,"ability_rom_offset":13956,"team_idx":14,"pos_idx":3,"rushing_power":69,"running_speed":44,"maximum_speed":56,"hitting_power":13,"ball_control":81,"receptions":56,"jerseyNumber":83,"ratings":{"rushing_power":69,"running_speed":44,"maximum_speed":56,"hitting_power":13,"ball_control":81,"receptions":56}},{"id":424,"team_id":14,"name":"Gerald Riggs","position":"RB","position_detail":"RB3","jersey":55,"face":191,"name_rom_offset":6819,"ability_rom_offset":13960,"team_idx":14,"pos_idx":4,"rushing_power":69,"running_speed":44,"maximum_speed":31,"hitting_power":81,"ball_control":81,"receptions":19,"jerseyNumber":37,"ratings":{"rushing_power":69,"running_speed":44,"maximum_speed":31,"hitting_power":81,"ball_control":81,"receptions":19}},{"id":425,"team_id":14,"name":"Kelvin Bryant","position":"RB","position_detail":"RB4","jersey":36,"face":174,"name_rom_offset":6831,"ability_rom_offset":13964,"team_idx":14,"pos_idx":5,"rushing_power":69,"running_speed":38,"maximum_speed":44,"hitting_power":19,"ball_control":81,"receptions":38,"jerseyNumber":24,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":44,"hitting_power":19,"ball_control":81,"receptions":38}},{"id":426,"team_id":14,"name":"Art Monk","position":"WR","position_detail":"WR1","jersey":129,"face":133,"name_rom_offset":6844,"ability_rom_offset":13968,"team_idx":14,"pos_idx":6,"rushing_power":69,"running_speed":38,"maximum_speed":44,"hitting_power":38,"ball_control":81,"receptions":63,"jerseyNumber":81,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":44,"hitting_power":38,"ball_control":81,"receptions":63}},{"id":427,"team_id":14,"name":"Gary Clark","position":"WR","position_detail":"WR2","jersey":132,"face":196,"name_rom_offset":6852,"ability_rom_offset":13972,"team_idx":14,"pos_idx":7,"rushing_power":69,"running_speed":38,"maximum_speed":50,"hitting_power":13,"ball_control":81,"receptions":75,"jerseyNumber":84,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":50,"hitting_power":13,"ball_control":81,"receptions":75}},{"id":428,"team_id":14,"name":"Brian Mitchell","position":"WR","position_detail":"WR3","jersey":48,"face":199,"name_rom_offset":6862,"ability_rom_offset":13976,"team_idx":14,"pos_idx":8,"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":31,"ball_control":81,"receptions":25,"jerseyNumber":30,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":31,"ball_control":81,"receptions":25}},{"id":429,"team_id":14,"name":"Joe Howard","position":"WR","position_detail":"WR4","jersey":128,"face":193,"name_rom_offset":6876,"ability_rom_offset":13980,"team_idx":14,"pos_idx":9,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":81,"receptions":44,"jerseyNumber":80,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":81,"receptions":44}},{"id":430,"team_id":14,"name":"Don Warren","position":"TE","position_detail":"TE1","jersey":133,"face":57,"name_rom_offset":6886,"ability_rom_offset":13984,"team_idx":14,"pos_idx":10,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":38,"ball_control":81,"receptions":31,"jerseyNumber":85,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":38,"ball_control":81,"receptions":31}},{"id":431,"team_id":14,"name":"Jimmie Johnson","position":"TE","position_detail":"TE2","jersey":136,"face":131,"name_rom_offset":6896,"ability_rom_offset":13988,"team_idx":14,"pos_idx":11,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":38,"ball_control":81,"receptions":31,"jerseyNumber":88,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":38,"ball_control":81,"receptions":31}},{"id":432,"team_id":14,"name":"Jeff Bostic","position":"OL","position_detail":"C","jersey":83,"face":28,"name_rom_offset":6910,"ability_rom_offset":13992,"team_idx":14,"pos_idx":12,"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":69,"jerseyNumber":53,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":69}},{"id":433,"team_id":14,"name":"Russ Grimm","position":"OL","position_detail":"LG","jersey":104,"face":56,"name_rom_offset":6921,"ability_rom_offset":13995,"team_idx":14,"pos_idx":13,"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":56,"jerseyNumber":68,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":56}},{"id":434,"team_id":14,"name":"Raleigh Mckenzie","position":"OL","position_detail":"RG","jersey":99,"face":43,"name_rom_offset":6931,"ability_rom_offset":13998,"team_idx":14,"pos_idx":14,"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":56,"jerseyNumber":63,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":56}},{"id":435,"team_id":14,"name":"Jim Lachey","position":"OL","position_detail":"LT","jersey":121,"face":52,"name_rom_offset":6947,"ability_rom_offset":14001,"team_idx":14,"pos_idx":15,"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":69,"jerseyNumber":79,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":69}},{"id":436,"team_id":14,"name":"Ed Simmons","position":"OL","position_detail":"RT","jersey":118,"face":181,"name_rom_offset":6957,"ability_rom_offset":14004,"team_idx":14,"pos_idx":16,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":63,"jerseyNumber":76,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":63}},{"id":437,"team_id":14,"name":"Markus Koch","position":"DL","position_detail":"RE","jersey":116,"face":67,"name_rom_offset":6967,"ability_rom_offset":14007,"team_idx":14,"pos_idx":17,"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":44,"pass_interceptions":19,"quickness":38,"jerseyNumber":74,"ratings":{"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":44,"pass_interceptions":19,"quickness":38}},{"id":438,"team_id":14,"name":"Darryl Grant","position":"DL","position_detail":"NT","jersey":119,"face":150,"name_rom_offset":6978,"ability_rom_offset":14011,"team_idx":14,"pos_idx":18,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":50,"pass_interceptions":19,"quickness":44,"jerseyNumber":77,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":50,"pass_interceptions":19,"quickness":44}},{"id":439,"team_id":14,"name":"Charles Mann","position":"DL","position_detail":"LE","jersey":113,"face":151,"name_rom_offset":6990,"ability_rom_offset":14015,"team_idx":14,"pos_idx":19,"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":56,"pass_interceptions":19,"quickness":63,"jerseyNumber":71,"ratings":{"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":56,"pass_interceptions":19,"quickness":63}},{"id":440,"team_id":14,"name":"Wilber Marshall","position":"LB","position_detail":"ROLB","jersey":88,"face":180,"name_rom_offset":7002,"ability_rom_offset":14019,"team_idx":14,"pos_idx":20,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":50,"pass_interceptions":31,"quickness":50,"jerseyNumber":58,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":50,"pass_interceptions":31,"quickness":50}},{"id":441,"team_id":14,"name":"Greg Manusky","position":"LB","position_detail":"RILB","jersey":145,"face":12,"name_rom_offset":7017,"ability_rom_offset":14023,"team_idx":14,"pos_idx":21,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":44,"pass_interceptions":19,"quickness":31,"jerseyNumber":91,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":44,"pass_interceptions":19,"quickness":31}},{"id":442,"team_id":14,"name":"Tracy Rocker","position":"LB","position_detail":"LILB","jersey":153,"face":142,"name_rom_offset":7029,"ability_rom_offset":14027,"team_idx":14,"pos_idx":22,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":50,"pass_interceptions":19,"quickness":44,"jerseyNumber":99,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":50,"pass_interceptions":19,"quickness":44}},{"id":443,"team_id":14,"name":"Andre Collins","position":"LB","position_detail":"LOLB","jersey":85,"face":173,"name_rom_offset":7041,"ability_rom_offset":14031,"team_idx":14,"pos_idx":23,"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":38,"pass_interceptions":19,"quickness":50,"jerseyNumber":55,"ratings":{"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":38,"pass_interceptions":19,"quickness":50}},{"id":444,"team_id":14,"name":"Darrell Green","position":"DB","position_detail":"RCB","jersey":40,"face":177,"name_rom_offset":7054,"ability_rom_offset":14035,"team_idx":14,"pos_idx":24,"rushing_power":56,"running_speed":44,"maximum_speed":75,"hitting_power":44,"pass_interceptions":44,"quickness":31,"jerseyNumber":28,"ratings":{"rushing_power":56,"running_speed":44,"maximum_speed":75,"hitting_power":44,"pass_interceptions":44,"quickness":31}},{"id":445,"team_id":14,"name":"Martin Mayhew","position":"DB","position_detail":"LCB","jersey":53,"face":134,"name_rom_offset":7067,"ability_rom_offset":14039,"team_idx":14,"pos_idx":25,"rushing_power":50,"running_speed":38,"maximum_speed":63,"hitting_power":31,"pass_interceptions":69,"quickness":38,"jerseyNumber":35,"ratings":{"rushing_power":50,"running_speed":38,"maximum_speed":63,"hitting_power":31,"pass_interceptions":69,"quickness":38}},{"id":446,"team_id":14,"name":"Todd Bowles","position":"DB","position_detail":"FS","jersey":35,"face":195,"name_rom_offset":7080,"ability_rom_offset":14043,"team_idx":14,"pos_idx":26,"rushing_power":31,"running_speed":25,"maximum_speed":44,"hitting_power":44,"pass_interceptions":50,"quickness":31,"jerseyNumber":23,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":44,"hitting_power":44,"pass_interceptions":50,"quickness":31}},{"id":447,"team_id":14,"name":"Alvin Walton","position":"DB","position_detail":"SS","jersey":64,"face":176,"name_rom_offset":7091,"ability_rom_offset":14047,"team_idx":14,"pos_idx":27,"rushing_power":31,"running_speed":25,"maximum_speed":44,"hitting_power":31,"pass_interceptions":44,"quickness":31,"jerseyNumber":40,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":44,"hitting_power":31,"pass_interceptions":44,"quickness":31}},{"id":448,"team_id":14,"name":"Chip Lohmiller","position":"K","position_detail":"K","jersey":8,"face":51,"name_rom_offset":7103,"ability_rom_offset":14051,"team_idx":14,"pos_idx":28,"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":50,"avoid_kick_block":81,"jerseyNumber":8,"ratings":{"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":50,"avoid_kick_block":81}},{"id":449,"team_id":14,"name":"Kelly Goodburn","position":"P","position_detail":"P","jersey":2,"face":32,"name_rom_offset":7117,"ability_rom_offset":14055,"team_idx":14,"pos_idx":29,"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":25,"avoid_kick_block":50,"jerseyNumber":2,"ratings":{"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":25,"avoid_kick_block":50}},{"id":450,"team_id":15,"name":"Phil Simms","position":"QB","position_detail":"QB1","jersey":17,"face":52,"name_rom_offset":7131,"ability_rom_offset":14059,"team_idx":15,"pos_idx":0,"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":50,"pass_control":63,"accuracy_of_passing":63,"avoid_pass_block":81,"jerseyNumber":11,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":50,"pass_control":63,"accuracy_of_passing":63,"avoid_pass_block":81}},{"id":451,"team_id":15,"name":"Jeff Hostetler","position":"QB","position_detail":"QB2","jersey":21,"face":25,"name_rom_offset":7141,"ability_rom_offset":14064,"team_idx":15,"pos_idx":1,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"passing_speed":38,"pass_control":31,"accuracy_of_passing":38,"avoid_pass_block":19,"jerseyNumber":15,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"passing_speed":38,"pass_control":31,"accuracy_of_passing":38,"avoid_pass_block":19}},{"id":452,"team_id":15,"name":"Ottis Anderson","position":"RB","position_detail":"RB1","jersey":36,"face":147,"name_rom_offset":7155,"ability_rom_offset":14069,"team_idx":15,"pos_idx":2,"rushing_power":69,"running_speed":56,"maximum_speed":50,"hitting_power":88,"ball_control":75,"receptions":31,"jerseyNumber":24,"ratings":{"rushing_power":69,"running_speed":56,"maximum_speed":50,"hitting_power":88,"ball_control":75,"receptions":31}},{"id":453,"team_id":15,"name":"David Meggett","position":"RB","position_detail":"RB2","jersey":48,"face":176,"name_rom_offset":7169,"ability_rom_offset":14073,"team_idx":15,"pos_idx":3,"rushing_power":69,"running_speed":38,"maximum_speed":56,"hitting_power":19,"ball_control":75,"receptions":50,"jerseyNumber":30,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":56,"hitting_power":19,"ball_control":75,"receptions":50}},{"id":454,"team_id":15,"name":"Maurice Carthon","position":"RB","position_detail":"RB3","jersey":68,"face":150,"name_rom_offset":7182,"ability_rom_offset":14077,"team_idx":15,"pos_idx":4,"rushing_power":69,"running_speed":44,"maximum_speed":25,"hitting_power":44,"ball_control":50,"receptions":25,"jerseyNumber":44,"ratings":{"rushing_power":69,"running_speed":44,"maximum_speed":25,"hitting_power":44,"ball_control":50,"receptions":25}},{"id":455,"team_id":15,"name":"Rodney Hampton","position":"RB","position_detail":"RB4","jersey":39,"face":178,"name_rom_offset":7197,"ability_rom_offset":14081,"team_idx":15,"pos_idx":5,"rushing_power":69,"running_speed":38,"maximum_speed":31,"hitting_power":38,"ball_control":63,"receptions":38,"jerseyNumber":27,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":31,"hitting_power":38,"ball_control":63,"receptions":38}},{"id":456,"team_id":15,"name":"Mark Ingram","position":"WR","position_detail":"WR1","jersey":130,"face":145,"name_rom_offset":7211,"ability_rom_offset":14085,"team_idx":15,"pos_idx":6,"rushing_power":69,"running_speed":44,"maximum_speed":56,"hitting_power":13,"ball_control":63,"receptions":50,"jerseyNumber":82,"ratings":{"rushing_power":69,"running_speed":44,"maximum_speed":56,"hitting_power":13,"ball_control":63,"receptions":50}},{"id":457,"team_id":15,"name":"Stephen Baker","position":"WR","position_detail":"WR2","jersey":133,"face":163,"name_rom_offset":7222,"ability_rom_offset":14089,"team_idx":15,"pos_idx":7,"rushing_power":69,"running_speed":44,"maximum_speed":56,"hitting_power":13,"ball_control":69,"receptions":56,"jerseyNumber":85,"ratings":{"rushing_power":69,"running_speed":44,"maximum_speed":56,"hitting_power":13,"ball_control":69,"receptions":56}},{"id":458,"team_id":15,"name":"Stacey Robinson","position":"WR","position_detail":"WR3","jersey":129,"face":201,"name_rom_offset":7235,"ability_rom_offset":14093,"team_idx":15,"pos_idx":8,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":44,"jerseyNumber":81,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":44}},{"id":459,"team_id":15,"name":"Odessa Turner","position":"WR","position_detail":"WR4","jersey":131,"face":195,"name_rom_offset":7250,"ability_rom_offset":14097,"team_idx":15,"pos_idx":9,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":44,"jerseyNumber":83,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":44}},{"id":460,"team_id":15,"name":"Mark Bavaro","position":"TE","position_detail":"TE1","jersey":137,"face":26,"name_rom_offset":7263,"ability_rom_offset":14101,"team_idx":15,"pos_idx":10,"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":69,"ball_control":69,"receptions":44,"jerseyNumber":89,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":69,"ball_control":69,"receptions":44}},{"id":461,"team_id":15,"name":"Howard Cross","position":"TE","position_detail":"TE2","jersey":135,"face":176,"name_rom_offset":7274,"ability_rom_offset":14105,"team_idx":15,"pos_idx":11,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":56,"ball_control":56,"receptions":31,"jerseyNumber":87,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":56,"ball_control":56,"receptions":31}},{"id":462,"team_id":15,"name":"Bart Oates","position":"OL","position_detail":"C","jersey":101,"face":31,"name_rom_offset":7286,"ability_rom_offset":14109,"team_idx":15,"pos_idx":12,"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":50,"jerseyNumber":65,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":50}},{"id":463,"team_id":15,"name":"William Roberts","position":"OL","position_detail":"LG","jersey":102,"face":175,"name_rom_offset":7296,"ability_rom_offset":14112,"team_idx":15,"pos_idx":13,"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":56,"jerseyNumber":66,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":56}},{"id":464,"team_id":15,"name":"Eric Moore","position":"OL","position_detail":"RG","jersey":96,"face":192,"name_rom_offset":7311,"ability_rom_offset":14115,"team_idx":15,"pos_idx":14,"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":63,"jerseyNumber":60,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":63}},{"id":465,"team_id":15,"name":"John Elliott","position":"OL","position_detail":"LT","jersey":118,"face":43,"name_rom_offset":7321,"ability_rom_offset":14118,"team_idx":15,"pos_idx":15,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":75,"jerseyNumber":76,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":75}},{"id":466,"team_id":15,"name":"Doug Riesenberg","position":"OL","position_detail":"RT","jersey":114,"face":51,"name_rom_offset":7333,"ability_rom_offset":14121,"team_idx":15,"pos_idx":16,"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":50,"jerseyNumber":72,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":50}},{"id":467,"team_id":15,"name":"Leonard Marshall","position":"DL","position_detail":"RE","jersey":112,"face":137,"name_rom_offset":7348,"ability_rom_offset":14124,"team_idx":15,"pos_idx":17,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":56,"pass_interceptions":19,"quickness":56,"jerseyNumber":70,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":56,"pass_interceptions":19,"quickness":56}},{"id":468,"team_id":15,"name":"Erik Howard","position":"DL","position_detail":"NT","jersey":116,"face":81,"name_rom_offset":7364,"ability_rom_offset":14128,"team_idx":15,"pos_idx":18,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":50,"pass_interceptions":19,"quickness":50,"jerseyNumber":74,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":50,"pass_interceptions":19,"quickness":50}},{"id":469,"team_id":15,"name":"Eric Dorsey","position":"DL","position_detail":"LE","jersey":119,"face":193,"name_rom_offset":7375,"ability_rom_offset":14132,"team_idx":15,"pos_idx":19,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":50,"pass_interceptions":19,"quickness":44,"jerseyNumber":77,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":50,"pass_interceptions":19,"quickness":44}},{"id":470,"team_id":15,"name":"Lawrence Taylor","position":"LB","position_detail":"ROLB","jersey":86,"face":207,"name_rom_offset":7386,"ability_rom_offset":14136,"team_idx":15,"pos_idx":20,"rushing_power":56,"running_speed":44,"maximum_speed":69,"hitting_power":75,"pass_interceptions":31,"quickness":81,"jerseyNumber":56,"ratings":{"rushing_power":56,"running_speed":44,"maximum_speed":69,"hitting_power":75,"pass_interceptions":31,"quickness":81}},{"id":471,"team_id":15,"name":"Pepper Johnson","position":"LB","position_detail":"RILB","jersey":82,"face":156,"name_rom_offset":7401,"ability_rom_offset":14140,"team_idx":15,"pos_idx":21,"rushing_power":44,"running_speed":38,"maximum_speed":56,"hitting_power":69,"pass_interceptions":31,"quickness":69,"jerseyNumber":52,"ratings":{"rushing_power":44,"running_speed":38,"maximum_speed":56,"hitting_power":69,"pass_interceptions":31,"quickness":69}},{"id":472,"team_id":15,"name":"Gary Reasons","position":"LB","position_detail":"LILB","jersey":85,"face":38,"name_rom_offset":7415,"ability_rom_offset":14144,"team_idx":15,"pos_idx":22,"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":38,"pass_interceptions":63,"quickness":44,"jerseyNumber":55,"ratings":{"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":38,"pass_interceptions":63,"quickness":44}},{"id":473,"team_id":15,"name":"Carl Banks","position":"LB","position_detail":"LOLB","jersey":88,"face":149,"name_rom_offset":7427,"ability_rom_offset":14148,"team_idx":15,"pos_idx":23,"rushing_power":44,"running_speed":38,"maximum_speed":50,"hitting_power":63,"pass_interceptions":19,"quickness":56,"jerseyNumber":58,"ratings":{"rushing_power":44,"running_speed":38,"maximum_speed":50,"hitting_power":63,"pass_interceptions":19,"quickness":56}},{"id":474,"team_id":15,"name":"Everson Walls","position":"DB","position_detail":"RCB","jersey":40,"face":196,"name_rom_offset":7437,"ability_rom_offset":14152,"team_idx":15,"pos_idx":24,"rushing_power":44,"running_speed":38,"maximum_speed":56,"hitting_power":31,"pass_interceptions":63,"quickness":44,"jerseyNumber":28,"ratings":{"rushing_power":44,"running_speed":38,"maximum_speed":56,"hitting_power":31,"pass_interceptions":63,"quickness":44}},{"id":475,"team_id":15,"name":"Mark Collins","position":"DB","position_detail":"LCB","jersey":37,"face":138,"name_rom_offset":7450,"ability_rom_offset":14156,"team_idx":15,"pos_idx":25,"rushing_power":44,"running_speed":38,"maximum_speed":56,"hitting_power":50,"pass_interceptions":44,"quickness":63,"jerseyNumber":25,"ratings":{"rushing_power":44,"running_speed":38,"maximum_speed":56,"hitting_power":50,"pass_interceptions":44,"quickness":63}},{"id":476,"team_id":15,"name":"Myron Guyton","position":"DB","position_detail":"FS","jersey":41,"face":161,"name_rom_offset":7462,"ability_rom_offset":14160,"team_idx":15,"pos_idx":26,"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":56,"pass_interceptions":44,"quickness":56,"jerseyNumber":29,"ratings":{"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":56,"pass_interceptions":44,"quickness":56}},{"id":477,"team_id":15,"name":"Greg Jackson","position":"DB","position_detail":"SS","jersey":71,"face":184,"name_rom_offset":7474,"ability_rom_offset":14164,"team_idx":15,"pos_idx":27,"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":56,"pass_interceptions":56,"quickness":56,"jerseyNumber":47,"ratings":{"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":56,"pass_interceptions":56,"quickness":56}},{"id":478,"team_id":15,"name":"Matt Bahr","position":"K","position_detail":"K","jersey":9,"face":32,"name_rom_offset":7486,"ability_rom_offset":14168,"team_idx":15,"pos_idx":28,"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":44,"avoid_kick_block":63,"jerseyNumber":9,"ratings":{"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":44,"avoid_kick_block":63}},{"id":479,"team_id":15,"name":"Sean Landeta","position":"P","position_detail":"P","jersey":5,"face":28,"name_rom_offset":7495,"ability_rom_offset":14172,"team_idx":15,"pos_idx":29,"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":81,"avoid_kick_block":81,"jerseyNumber":5,"ratings":{"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":81,"avoid_kick_block":81}},{"id":480,"team_id":16,"name":"Qb Eagles","position":"QB","position_detail":"QB1","jersey":0,"face":212,"name_rom_offset":7507,"ability_rom_offset":14176,"team_idx":16,"pos_idx":0,"rushing_power":69,"running_speed":25,"maximum_speed":56,"hitting_power":13,"passing_speed":63,"pass_control":69,"accuracy_of_passing":63,"avoid_pass_block":63,"jerseyNumber":0,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":56,"hitting_power":13,"passing_speed":63,"pass_control":69,"accuracy_of_passing":63,"avoid_pass_block":63}},{"id":481,"team_id":16,"name":"Jim Mcmahon","position":"QB","position_detail":"QB2","jersey":9,"face":27,"name_rom_offset":7516,"ability_rom_offset":14181,"team_idx":16,"pos_idx":1,"rushing_power":69,"running_speed":25,"maximum_speed":6,"hitting_power":13,"passing_speed":38,"pass_control":38,"accuracy_of_passing":38,"avoid_pass_block":38,"jerseyNumber":9,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":6,"hitting_power":13,"passing_speed":38,"pass_control":38,"accuracy_of_passing":38,"avoid_pass_block":38}},{"id":482,"team_id":16,"name":"Keith Byars","position":"RB","position_detail":"RB1","jersey":65,"face":143,"name_rom_offset":7527,"ability_rom_offset":14186,"team_idx":16,"pos_idx":2,"rushing_power":69,"running_speed":38,"maximum_speed":31,"hitting_power":38,"ball_control":50,"receptions":69,"jerseyNumber":41,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":31,"hitting_power":38,"ball_control":50,"receptions":69}},{"id":483,"team_id":16,"name":"Heath Sherman","position":"RB","position_detail":"RB2","jersey":35,"face":205,"name_rom_offset":7538,"ability_rom_offset":14190,"team_idx":16,"pos_idx":3,"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":38,"ball_control":31,"receptions":31,"jerseyNumber":23,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":38,"ball_control":31,"receptions":31}},{"id":484,"team_id":16,"name":"Anthony Toney","position":"RB","position_detail":"RB3","jersey":37,"face":197,"name_rom_offset":7551,"ability_rom_offset":14194,"team_idx":16,"pos_idx":4,"rushing_power":69,"running_speed":38,"maximum_speed":31,"hitting_power":38,"ball_control":50,"receptions":25,"jerseyNumber":25,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":31,"hitting_power":38,"ball_control":50,"receptions":25}},{"id":485,"team_id":16,"name":"Robert Drummond","position":"RB","position_detail":"RB4","jersey":54,"face":133,"name_rom_offset":7564,"ability_rom_offset":14198,"team_idx":16,"pos_idx":5,"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":31,"ball_control":50,"receptions":25,"jerseyNumber":36,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":31,"ball_control":50,"receptions":25}},{"id":486,"team_id":16,"name":"Fred Barnett","position":"WR","position_detail":"WR1","jersey":134,"face":134,"name_rom_offset":7579,"ability_rom_offset":14202,"team_idx":16,"pos_idx":6,"rushing_power":69,"running_speed":31,"maximum_speed":38,"hitting_power":13,"ball_control":50,"receptions":56,"jerseyNumber":86,"ratings":{"rushing_power":69,"running_speed":31,"maximum_speed":38,"hitting_power":13,"ball_control":50,"receptions":56}},{"id":487,"team_id":16,"name":"Calvin Williams","position":"WR","position_detail":"WR2","jersey":137,"face":137,"name_rom_offset":7591,"ability_rom_offset":14206,"team_idx":16,"pos_idx":7,"rushing_power":69,"running_speed":31,"maximum_speed":31,"hitting_power":13,"ball_control":50,"receptions":50,"jerseyNumber":89,"ratings":{"rushing_power":69,"running_speed":31,"maximum_speed":31,"hitting_power":13,"ball_control":50,"receptions":50}},{"id":488,"team_id":16,"name":"Mike Quick","position":"WR","position_detail":"WR3","jersey":130,"face":159,"name_rom_offset":7606,"ability_rom_offset":14210,"team_idx":16,"pos_idx":8,"rushing_power":69,"running_speed":31,"maximum_speed":31,"hitting_power":13,"ball_control":50,"receptions":44,"jerseyNumber":82,"ratings":{"rushing_power":69,"running_speed":31,"maximum_speed":31,"hitting_power":13,"ball_control":50,"receptions":44}},{"id":489,"team_id":16,"name":"Kenny Jackson","position":"WR","position_detail":"WR4","jersey":133,"face":156,"name_rom_offset":7616,"ability_rom_offset":14214,"team_idx":16,"pos_idx":9,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":44,"jerseyNumber":85,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":44}},{"id":490,"team_id":16,"name":"Keith Jackson","position":"TE","position_detail":"TE1","jersey":136,"face":206,"name_rom_offset":7629,"ability_rom_offset":14218,"team_idx":16,"pos_idx":10,"rushing_power":69,"running_speed":25,"maximum_speed":50,"hitting_power":63,"ball_control":50,"receptions":63,"jerseyNumber":88,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":50,"hitting_power":63,"ball_control":50,"receptions":63}},{"id":491,"team_id":16,"name":"Harper Le Bel","position":"TE","position_detail":"TE2","jersey":135,"face":33,"name_rom_offset":7642,"ability_rom_offset":14222,"team_idx":16,"pos_idx":11,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":50,"ball_control":50,"receptions":25,"jerseyNumber":87,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":50,"ball_control":50,"receptions":25}},{"id":492,"team_id":16,"name":"David Alexander","position":"OL","position_detail":"C","jersey":114,"face":51,"name_rom_offset":7655,"ability_rom_offset":14226,"team_idx":16,"pos_idx":12,"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":38,"jerseyNumber":72,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":38}},{"id":493,"team_id":16,"name":"Mike Schad","position":"OL","position_detail":"LG","jersey":121,"face":68,"name_rom_offset":7670,"ability_rom_offset":14229,"team_idx":16,"pos_idx":13,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":50,"jerseyNumber":79,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":50}},{"id":494,"team_id":16,"name":"Ron Solt","position":"OL","position_detail":"RG","jersey":102,"face":72,"name_rom_offset":7680,"ability_rom_offset":14232,"team_idx":16,"pos_idx":14,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":38,"jerseyNumber":66,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":38}},{"id":495,"team_id":16,"name":"Ron Heller","position":"OL","position_detail":"LT","jersey":115,"face":75,"name_rom_offset":7688,"ability_rom_offset":14235,"team_idx":16,"pos_idx":15,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":50,"jerseyNumber":73,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":50}},{"id":496,"team_id":16,"name":"R. Singletary","position":"OL","position_detail":"RT","jersey":104,"face":138,"name_rom_offset":7698,"ability_rom_offset":14238,"team_idx":16,"pos_idx":16,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":50,"jerseyNumber":68,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":50}},{"id":497,"team_id":16,"name":"Clyde Simmons","position":"DL","position_detail":"RE","jersey":150,"face":155,"name_rom_offset":7711,"ability_rom_offset":14241,"team_idx":16,"pos_idx":17,"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":50,"pass_interceptions":19,"quickness":69,"jerseyNumber":96,"ratings":{"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":50,"pass_interceptions":19,"quickness":69}},{"id":498,"team_id":16,"name":"Mike Golic","position":"DL","position_detail":"NT","jersey":144,"face":46,"name_rom_offset":7724,"ability_rom_offset":14245,"team_idx":16,"pos_idx":18,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":50,"pass_interceptions":31,"quickness":44,"jerseyNumber":90,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":50,"pass_interceptions":31,"quickness":44}},{"id":499,"team_id":16,"name":"Reggie White","position":"DL","position_detail":"LE","jersey":146,"face":153,"name_rom_offset":7734,"ability_rom_offset":14249,"team_idx":16,"pos_idx":19,"rushing_power":50,"running_speed":38,"maximum_speed":56,"hitting_power":69,"pass_interceptions":31,"quickness":75,"jerseyNumber":92,"ratings":{"rushing_power":50,"running_speed":38,"maximum_speed":56,"hitting_power":69,"pass_interceptions":31,"quickness":75}},{"id":500,"team_id":16,"name":"Jessie Small","position":"LB","position_detail":"ROLB","jersey":82,"face":140,"name_rom_offset":7746,"ability_rom_offset":14253,"team_idx":16,"pos_idx":20,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":44,"pass_interceptions":19,"quickness":44,"jerseyNumber":52,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":44,"pass_interceptions":19,"quickness":44}},{"id":501,"team_id":16,"name":"Jerome Brown","position":"LB","position_detail":"RILB","jersey":153,"face":141,"name_rom_offset":7758,"ability_rom_offset":14257,"team_idx":16,"pos_idx":21,"rushing_power":50,"running_speed":38,"maximum_speed":56,"hitting_power":69,"pass_interceptions":19,"quickness":63,"jerseyNumber":99,"ratings":{"rushing_power":50,"running_speed":38,"maximum_speed":56,"hitting_power":69,"pass_interceptions":19,"quickness":63}},{"id":502,"team_id":16,"name":"Byron Evans","position":"LB","position_detail":"LILB","jersey":86,"face":199,"name_rom_offset":7770,"ability_rom_offset":14261,"team_idx":16,"pos_idx":22,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":44,"pass_interceptions":31,"quickness":44,"jerseyNumber":56,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":44,"pass_interceptions":31,"quickness":44}},{"id":503,"team_id":16,"name":"Seth Joyner","position":"LB","position_detail":"LOLB","jersey":89,"face":177,"name_rom_offset":7781,"ability_rom_offset":14265,"team_idx":16,"pos_idx":23,"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":63,"pass_interceptions":31,"quickness":75,"jerseyNumber":59,"ratings":{"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":63,"pass_interceptions":31,"quickness":75}},{"id":504,"team_id":16,"name":"Eric Allen","position":"DB","position_detail":"RCB","jersey":33,"face":196,"name_rom_offset":7792,"ability_rom_offset":14269,"team_idx":16,"pos_idx":24,"rushing_power":50,"running_speed":38,"maximum_speed":44,"hitting_power":50,"pass_interceptions":50,"quickness":69,"jerseyNumber":21,"ratings":{"rushing_power":50,"running_speed":38,"maximum_speed":44,"hitting_power":50,"pass_interceptions":50,"quickness":69}},{"id":505,"team_id":16,"name":"Ben Smith","position":"DB","position_detail":"LCB","jersey":38,"face":198,"name_rom_offset":7802,"ability_rom_offset":14273,"team_idx":16,"pos_idx":25,"rushing_power":50,"running_speed":38,"maximum_speed":38,"hitting_power":31,"pass_interceptions":50,"quickness":63,"jerseyNumber":26,"ratings":{"rushing_power":50,"running_speed":38,"maximum_speed":38,"hitting_power":31,"pass_interceptions":50,"quickness":63}},{"id":506,"team_id":16,"name":"Wes Hopkins","position":"DB","position_detail":"FS","jersey":72,"face":150,"name_rom_offset":7811,"ability_rom_offset":14277,"team_idx":16,"pos_idx":26,"rushing_power":31,"running_speed":25,"maximum_speed":19,"hitting_power":50,"pass_interceptions":56,"quickness":31,"jerseyNumber":48,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":19,"hitting_power":50,"pass_interceptions":56,"quickness":31}},{"id":507,"team_id":16,"name":"Andre Waters","position":"DB","position_detail":"SS","jersey":32,"face":139,"name_rom_offset":7822,"ability_rom_offset":14281,"team_idx":16,"pos_idx":27,"rushing_power":31,"running_speed":25,"maximum_speed":19,"hitting_power":31,"pass_interceptions":25,"quickness":19,"jerseyNumber":20,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":19,"hitting_power":31,"pass_interceptions":25,"quickness":19}},{"id":508,"team_id":16,"name":"Roger Ruzek","position":"K","position_detail":"K","jersey":7,"face":23,"name_rom_offset":7834,"ability_rom_offset":14285,"team_idx":16,"pos_idx":28,"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":50,"avoid_kick_block":25,"jerseyNumber":7,"ratings":{"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":50,"avoid_kick_block":25}},{"id":509,"team_id":16,"name":"Jeff Feagles","position":"P","position_detail":"P","jersey":5,"face":22,"name_rom_offset":7845,"ability_rom_offset":14289,"team_idx":16,"pos_idx":29,"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":50,"avoid_kick_block":31,"jerseyNumber":5,"ratings":{"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":50,"avoid_kick_block":31}},{"id":510,"team_id":17,"name":"Timm Rosenbach","position":"QB","position_detail":"QB1","jersey":3,"face":58,"name_rom_offset":7857,"ability_rom_offset":14293,"team_idx":17,"pos_idx":0,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":13,"passing_speed":31,"pass_control":44,"accuracy_of_passing":38,"avoid_pass_block":31,"jerseyNumber":3,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":13,"passing_speed":31,"pass_control":44,"accuracy_of_passing":38,"avoid_pass_block":31}},{"id":511,"team_id":17,"name":"Tom Tupa","position":"QB","position_detail":"QB2","jersey":25,"face":33,"name_rom_offset":7871,"ability_rom_offset":14298,"team_idx":17,"pos_idx":1,"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":44,"pass_control":38,"accuracy_of_passing":31,"avoid_pass_block":38,"jerseyNumber":19,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":44,"pass_control":38,"accuracy_of_passing":31,"avoid_pass_block":38}},{"id":512,"team_id":17,"name":"Johnny Johnson","position":"RB","position_detail":"RB1","jersey":57,"face":61,"name_rom_offset":7879,"ability_rom_offset":14303,"team_idx":17,"pos_idx":2,"rushing_power":69,"running_speed":38,"maximum_speed":50,"hitting_power":38,"ball_control":50,"receptions":38,"jerseyNumber":39,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":50,"hitting_power":38,"ball_control":50,"receptions":38}},{"id":513,"team_id":17,"name":"Roy Green","position":"RB","position_detail":"RB2","jersey":129,"face":199,"name_rom_offset":7893,"ability_rom_offset":14307,"team_idx":17,"pos_idx":3,"rushing_power":69,"running_speed":38,"maximum_speed":44,"hitting_power":13,"ball_control":50,"receptions":56,"jerseyNumber":81,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":44,"hitting_power":13,"ball_control":50,"receptions":56}},{"id":514,"team_id":17,"name":"Ron Wolfley","position":"RB","position_detail":"RB3","jersey":36,"face":79,"name_rom_offset":7902,"ability_rom_offset":14311,"team_idx":17,"pos_idx":4,"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":38,"ball_control":50,"receptions":25,"jerseyNumber":24,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":38,"ball_control":50,"receptions":25}},{"id":515,"team_id":17,"name":"Vai Sikahema","position":"RB","position_detail":"RB4","jersey":54,"face":138,"name_rom_offset":7913,"ability_rom_offset":14315,"team_idx":17,"pos_idx":5,"rushing_power":69,"running_speed":44,"maximum_speed":38,"hitting_power":25,"ball_control":50,"receptions":31,"jerseyNumber":36,"ratings":{"rushing_power":69,"running_speed":44,"maximum_speed":38,"hitting_power":25,"ball_control":50,"receptions":31}},{"id":516,"team_id":17,"name":"Ricky Proehl","position":"WR","position_detail":"WR1","jersey":135,"face":78,"name_rom_offset":7925,"ability_rom_offset":14319,"team_idx":17,"pos_idx":6,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":13,"ball_control":50,"receptions":69,"jerseyNumber":87,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":13,"ball_control":50,"receptions":69}},{"id":517,"team_id":17,"name":"Ernie Jones","position":"WR","position_detail":"WR2","jersey":134,"face":162,"name_rom_offset":7937,"ability_rom_offset":14323,"team_idx":17,"pos_idx":7,"rushing_power":69,"running_speed":31,"maximum_speed":38,"hitting_power":13,"ball_control":50,"receptions":56,"jerseyNumber":86,"ratings":{"rushing_power":69,"running_speed":31,"maximum_speed":38,"hitting_power":13,"ball_control":50,"receptions":56}},{"id":518,"team_id":17,"name":"Anthony Thompson","position":"WR","position_detail":"WR3","jersey":52,"face":168,"name_rom_offset":7948,"ability_rom_offset":14327,"team_idx":17,"pos_idx":8,"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":38,"ball_control":50,"receptions":25,"jerseyNumber":34,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":38,"ball_control":50,"receptions":25}},{"id":519,"team_id":17,"name":"J.t. Smith","position":"WR","position_detail":"WR4","jersey":132,"face":201,"name_rom_offset":7964,"ability_rom_offset":14331,"team_idx":17,"pos_idx":9,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":50,"jerseyNumber":84,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":50}},{"id":520,"team_id":17,"name":"Walter Reeves","position":"TE","position_detail":"TE1","jersey":137,"face":192,"name_rom_offset":7974,"ability_rom_offset":14335,"team_idx":17,"pos_idx":10,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":44,"ball_control":50,"receptions":38,"jerseyNumber":89,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":44,"ball_control":50,"receptions":38}},{"id":521,"team_id":17,"name":"Tim Jorden","position":"TE","position_detail":"TE2","jersey":133,"face":50,"name_rom_offset":7987,"ability_rom_offset":14339,"team_idx":17,"pos_idx":11,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":38,"ball_control":50,"receptions":25,"jerseyNumber":85,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":38,"ball_control":50,"receptions":25}},{"id":522,"team_id":17,"name":"Bill Lewis","position":"OL","position_detail":"C","jersey":81,"face":9,"name_rom_offset":7997,"ability_rom_offset":14343,"team_idx":17,"pos_idx":12,"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":38,"jerseyNumber":51,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":38}},{"id":523,"team_id":17,"name":"Derek Kennard","position":"OL","position_detail":"LG","jersey":112,"face":185,"name_rom_offset":8007,"ability_rom_offset":14346,"team_idx":17,"pos_idx":13,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":56,"jerseyNumber":70,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":56}},{"id":524,"team_id":17,"name":"Lance Smith","position":"OL","position_detail":"RG","jersey":97,"face":188,"name_rom_offset":8020,"ability_rom_offset":14349,"team_idx":17,"pos_idx":14,"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":38,"jerseyNumber":61,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":38}},{"id":525,"team_id":17,"name":"Luis Sharpe","position":"OL","position_detail":"LT","jersey":103,"face":151,"name_rom_offset":8031,"ability_rom_offset":14352,"team_idx":17,"pos_idx":15,"rushing_power":69,"running_speed":25,"maximum_speed":50,"hitting_power":63,"jerseyNumber":67,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":50,"hitting_power":63}},{"id":526,"team_id":17,"name":"Tootie Robbins","position":"OL","position_detail":"RT","jersey":99,"face":149,"name_rom_offset":8042,"ability_rom_offset":14355,"team_idx":17,"pos_idx":16,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":56,"jerseyNumber":63,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":56}},{"id":527,"team_id":17,"name":"Rod Saddler","position":"DL","position_detail":"RE","jersey":114,"face":167,"name_rom_offset":8056,"ability_rom_offset":14358,"team_idx":17,"pos_idx":17,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":50,"pass_interceptions":19,"quickness":50,"jerseyNumber":72,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":50,"pass_interceptions":19,"quickness":50}},{"id":528,"team_id":17,"name":"Jim Wahler","position":"DL","position_detail":"NT","jersey":102,"face":30,"name_rom_offset":8067,"ability_rom_offset":14362,"team_idx":17,"pos_idx":18,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":44,"pass_interceptions":19,"quickness":44,"jerseyNumber":66,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":44,"pass_interceptions":19,"quickness":44}},{"id":529,"team_id":17,"name":"Freddie Joe Nunn","position":"DL","position_detail":"LE","jersey":120,"face":205,"name_rom_offset":8077,"ability_rom_offset":14366,"team_idx":17,"pos_idx":19,"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":56,"pass_interceptions":19,"quickness":56,"jerseyNumber":78,"ratings":{"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":56,"pass_interceptions":19,"quickness":56}},{"id":530,"team_id":17,"name":"Ken Harvey","position":"LB","position_detail":"ROLB","jersey":86,"face":203,"name_rom_offset":8093,"ability_rom_offset":14370,"team_idx":17,"pos_idx":20,"rushing_power":44,"running_speed":31,"maximum_speed":56,"hitting_power":63,"pass_interceptions":19,"quickness":63,"jerseyNumber":56,"ratings":{"rushing_power":44,"running_speed":31,"maximum_speed":56,"hitting_power":63,"pass_interceptions":19,"quickness":63}},{"id":531,"team_id":17,"name":"Garth Jax","position":"LB","position_detail":"RILB","jersey":83,"face":67,"name_rom_offset":8103,"ability_rom_offset":14374,"team_idx":17,"pos_idx":21,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":31,"pass_interceptions":31,"quickness":44,"jerseyNumber":53,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":31,"pass_interceptions":31,"quickness":44}},{"id":532,"team_id":17,"name":"Eric Hill","position":"LB","position_detail":"LILB","jersey":88,"face":161,"name_rom_offset":8112,"ability_rom_offset":14378,"team_idx":17,"pos_idx":22,"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":38,"pass_interceptions":19,"quickness":38,"jerseyNumber":58,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":38,"pass_interceptions":19,"quickness":38}},{"id":533,"team_id":17,"name":"Anthony Bell","position":"LB","position_detail":"LOLB","jersey":85,"face":141,"name_rom_offset":8121,"ability_rom_offset":14382,"team_idx":17,"pos_idx":23,"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":38,"pass_interceptions":31,"quickness":44,"jerseyNumber":55,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":38,"pass_interceptions":31,"quickness":44}},{"id":534,"team_id":17,"name":"Jay Taylor","position":"DB","position_detail":"RCB","jersey":39,"face":150,"name_rom_offset":8133,"ability_rom_offset":14386,"team_idx":17,"pos_idx":24,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":19,"pass_interceptions":50,"quickness":31,"jerseyNumber":27,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":19,"pass_interceptions":50,"quickness":31}},{"id":535,"team_id":17,"name":"Cedric Mack","position":"DB","position_detail":"LCB","jersey":71,"face":170,"name_rom_offset":8143,"ability_rom_offset":14390,"team_idx":17,"pos_idx":25,"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":38,"pass_interceptions":44,"quickness":44,"jerseyNumber":47,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":38,"pass_interceptions":44,"quickness":44}},{"id":536,"team_id":17,"name":"Lonnie Young","position":"DB","position_detail":"FS","jersey":67,"face":143,"name_rom_offset":8154,"ability_rom_offset":14394,"team_idx":17,"pos_idx":26,"rushing_power":31,"running_speed":69,"maximum_speed":44,"hitting_power":44,"pass_interceptions":56,"quickness":44,"jerseyNumber":43,"ratings":{"rushing_power":31,"running_speed":69,"maximum_speed":44,"hitting_power":44,"pass_interceptions":56,"quickness":44}},{"id":537,"team_id":17,"name":"Tim Mcdonald","position":"DB","position_detail":"SS","jersey":70,"face":203,"name_rom_offset":8166,"ability_rom_offset":14398,"team_idx":17,"pos_idx":27,"rushing_power":44,"running_speed":38,"maximum_speed":56,"hitting_power":56,"pass_interceptions":56,"quickness":69,"jerseyNumber":46,"ratings":{"rushing_power":44,"running_speed":38,"maximum_speed":56,"hitting_power":56,"pass_interceptions":56,"quickness":69}},{"id":538,"team_id":17,"name":"Al Del Greco","position":"K","position_detail":"K","jersey":23,"face":47,"name_rom_offset":8178,"ability_rom_offset":14402,"team_idx":17,"pos_idx":28,"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":19,"avoid_kick_block":56,"jerseyNumber":17,"ratings":{"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":19,"avoid_kick_block":56}},{"id":539,"team_id":17,"name":"Rich Camarillo","position":"P","position_detail":"P","jersey":22,"face":27,"name_rom_offset":8190,"ability_rom_offset":14406,"team_idx":17,"pos_idx":29,"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":75,"avoid_kick_block":81,"jerseyNumber":16,"ratings":{"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":75,"avoid_kick_block":81}},{"id":540,"team_id":18,"name":"Troy Aikman","position":"QB","position_detail":"QB1","jersey":8,"face":22,"name_rom_offset":8204,"ability_rom_offset":14410,"team_idx":18,"pos_idx":0,"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":50,"pass_control":44,"accuracy_of_passing":50,"avoid_pass_block":50,"jerseyNumber":8,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":50,"pass_control":44,"accuracy_of_passing":50,"avoid_pass_block":50}},{"id":541,"team_id":18,"name":"Babe Laufenberg","position":"QB","position_detail":"QB2","jersey":21,"face":5,"name_rom_offset":8215,"ability_rom_offset":14415,"team_idx":18,"pos_idx":1,"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":44,"pass_control":38,"accuracy_of_passing":31,"avoid_pass_block":38,"jerseyNumber":15,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":44,"pass_control":38,"accuracy_of_passing":31,"avoid_pass_block":38}},{"id":542,"team_id":18,"name":"Emmitt Smith","position":"RB","position_detail":"RB1","jersey":34,"face":198,"name_rom_offset":8230,"ability_rom_offset":14420,"team_idx":18,"pos_idx":2,"rushing_power":69,"running_speed":38,"maximum_speed":56,"hitting_power":31,"ball_control":50,"receptions":38,"jerseyNumber":22,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":56,"hitting_power":31,"ball_control":50,"receptions":38}},{"id":543,"team_id":18,"name":"Tommie Agee","position":"RB","position_detail":"RB2","jersey":52,"face":201,"name_rom_offset":8242,"ability_rom_offset":14424,"team_idx":18,"pos_idx":3,"rushing_power":69,"running_speed":38,"maximum_speed":25,"hitting_power":44,"ball_control":50,"receptions":44,"jerseyNumber":34,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":25,"hitting_power":44,"ball_control":50,"receptions":44}},{"id":544,"team_id":18,"name":"Alonzo Highsmith","position":"RB","position_detail":"RB3","jersey":50,"face":156,"name_rom_offset":8253,"ability_rom_offset":14428,"team_idx":18,"pos_idx":4,"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":38,"ball_control":50,"receptions":44,"jerseyNumber":32,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":38,"ball_control":50,"receptions":44}},{"id":545,"team_id":18,"name":"Robert Perryman","position":"RB","position_detail":"RB4","jersey":57,"face":163,"name_rom_offset":8269,"ability_rom_offset":14432,"team_idx":18,"pos_idx":5,"rushing_power":69,"running_speed":38,"maximum_speed":31,"hitting_power":38,"ball_control":50,"receptions":25,"jerseyNumber":39,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":31,"hitting_power":38,"ball_control":50,"receptions":25}},{"id":546,"team_id":18,"name":"Kelvin Martin","position":"WR","position_detail":"WR1","jersey":131,"face":150,"name_rom_offset":8284,"ability_rom_offset":14436,"team_idx":18,"pos_idx":6,"rushing_power":69,"running_speed":31,"maximum_speed":38,"hitting_power":13,"ball_control":50,"receptions":56,"jerseyNumber":83,"ratings":{"rushing_power":69,"running_speed":31,"maximum_speed":38,"hitting_power":13,"ball_control":50,"receptions":56}},{"id":547,"team_id":18,"name":"Michael Irvin","position":"WR","position_detail":"WR2","jersey":136,"face":161,"name_rom_offset":8297,"ability_rom_offset":14440,"team_idx":18,"pos_idx":7,"rushing_power":69,"running_speed":38,"maximum_speed":44,"hitting_power":13,"ball_control":50,"receptions":50,"jerseyNumber":88,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":44,"hitting_power":13,"ball_control":50,"receptions":50}},{"id":548,"team_id":18,"name":"Alexander Wright","position":"WR","position_detail":"WR3","jersey":129,"face":170,"name_rom_offset":8310,"ability_rom_offset":14444,"team_idx":18,"pos_idx":8,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":44,"jerseyNumber":81,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":44}},{"id":549,"team_id":18,"name":"James Dixon","position":"WR","position_detail":"WR4","jersey":134,"face":134,"name_rom_offset":8326,"ability_rom_offset":14448,"team_idx":18,"pos_idx":9,"rushing_power":69,"running_speed":31,"maximum_speed":31,"hitting_power":13,"ball_control":50,"receptions":44,"jerseyNumber":86,"ratings":{"rushing_power":69,"running_speed":31,"maximum_speed":31,"hitting_power":13,"ball_control":50,"receptions":44}},{"id":550,"team_id":18,"name":"Jay Novacek","position":"TE","position_detail":"TE1","jersey":132,"face":80,"name_rom_offset":8337,"ability_rom_offset":14452,"team_idx":18,"pos_idx":10,"rushing_power":69,"running_speed":25,"maximum_speed":44,"hitting_power":69,"ball_control":50,"receptions":69,"jerseyNumber":84,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":44,"hitting_power":69,"ball_control":50,"receptions":69}},{"id":551,"team_id":18,"name":"Rob Awalt","position":"TE","position_detail":"TE2","jersey":137,"face":30,"name_rom_offset":8348,"ability_rom_offset":14456,"team_idx":18,"pos_idx":11,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":56,"ball_control":50,"receptions":31,"jerseyNumber":89,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":56,"ball_control":50,"receptions":31}},{"id":552,"team_id":18,"name":"Mark Stepnoski","position":"OL","position_detail":"C","jersey":83,"face":44,"name_rom_offset":8357,"ability_rom_offset":14460,"team_idx":18,"pos_idx":12,"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":38,"jerseyNumber":53,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":38}},{"id":553,"team_id":18,"name":"Crawford Ker","position":"OL","position_detail":"LG","jersey":104,"face":75,"name_rom_offset":8371,"ability_rom_offset":14463,"team_idx":18,"pos_idx":13,"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":50,"jerseyNumber":68,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":50}},{"id":554,"team_id":18,"name":"John Gesek","position":"OL","position_detail":"RG","jersey":103,"face":76,"name_rom_offset":8383,"ability_rom_offset":14466,"team_idx":18,"pos_idx":14,"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":44,"jerseyNumber":67,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":44}},{"id":555,"team_id":18,"name":"Kevin Gogan","position":"OL","position_detail":"LT","jersey":102,"face":47,"name_rom_offset":8393,"ability_rom_offset":14469,"team_idx":18,"pos_idx":15,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":56,"jerseyNumber":66,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":56}},{"id":556,"team_id":18,"name":"Nate Newton","position":"OL","position_detail":"RT","jersey":97,"face":205,"name_rom_offset":8404,"ability_rom_offset":14472,"team_idx":18,"pos_idx":16,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":75,"jerseyNumber":61,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":75}},{"id":557,"team_id":18,"name":"Tony Tolbert","position":"DL","position_detail":"RE","jersey":146,"face":192,"name_rom_offset":8415,"ability_rom_offset":14475,"team_idx":18,"pos_idx":17,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":50,"pass_interceptions":19,"quickness":56,"jerseyNumber":92,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":50,"pass_interceptions":19,"quickness":56}},{"id":558,"team_id":18,"name":"Danny Noonan","position":"DL","position_detail":"NT","jersey":115,"face":68,"name_rom_offset":8427,"ability_rom_offset":14479,"team_idx":18,"pos_idx":18,"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":50,"pass_interceptions":19,"quickness":50,"jerseyNumber":73,"ratings":{"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":50,"pass_interceptions":19,"quickness":50}},{"id":559,"team_id":18,"name":"Daniel Stubbs","position":"DL","position_detail":"LE","jersey":150,"face":160,"name_rom_offset":8439,"ability_rom_offset":14483,"team_idx":18,"pos_idx":19,"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":56,"pass_interceptions":19,"quickness":69,"jerseyNumber":96,"ratings":{"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":56,"pass_interceptions":19,"quickness":69}},{"id":560,"team_id":18,"name":"Ken Norton","position":"LB","position_detail":"ROLB","jersey":81,"face":160,"name_rom_offset":8452,"ability_rom_offset":14487,"team_idx":18,"pos_idx":20,"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":38,"pass_interceptions":31,"quickness":44,"jerseyNumber":51,"ratings":{"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":38,"pass_interceptions":31,"quickness":44}},{"id":561,"team_id":18,"name":"Eugene Lockhart","position":"LB","position_detail":"RILB","jersey":86,"face":164,"name_rom_offset":8462,"ability_rom_offset":14491,"team_idx":18,"pos_idx":21,"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":56,"pass_interceptions":19,"quickness":56,"jerseyNumber":56,"ratings":{"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":56,"pass_interceptions":19,"quickness":56}},{"id":562,"team_id":18,"name":"Jimmie Jones","position":"LB","position_detail":"LILB","jersey":151,"face":209,"name_rom_offset":8477,"ability_rom_offset":14495,"team_idx":18,"pos_idx":22,"rushing_power":31,"running_speed":31,"maximum_speed":50,"hitting_power":56,"pass_interceptions":19,"quickness":69,"jerseyNumber":97,"ratings":{"rushing_power":31,"running_speed":31,"maximum_speed":50,"hitting_power":56,"pass_interceptions":19,"quickness":69}},{"id":563,"team_id":18,"name":"Jack Del Rio","position":"LB","position_detail":"LOLB","jersey":85,"face":67,"name_rom_offset":8489,"ability_rom_offset":14499,"team_idx":18,"pos_idx":23,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":19,"quickness":44,"jerseyNumber":55,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":19,"quickness":44}},{"id":564,"team_id":18,"name":"Manny Hendrix","position":"DB","position_detail":"RCB","jersey":69,"face":173,"name_rom_offset":8501,"ability_rom_offset":14503,"team_idx":18,"pos_idx":24,"rushing_power":50,"running_speed":38,"maximum_speed":63,"hitting_power":50,"pass_interceptions":44,"quickness":50,"jerseyNumber":45,"ratings":{"rushing_power":50,"running_speed":38,"maximum_speed":63,"hitting_power":50,"pass_interceptions":44,"quickness":50}},{"id":565,"team_id":18,"name":"Issiac Holt","position":"DB","position_detail":"LCB","jersey":48,"face":145,"name_rom_offset":8514,"ability_rom_offset":14507,"team_idx":18,"pos_idx":25,"rushing_power":44,"running_speed":38,"maximum_speed":56,"hitting_power":56,"pass_interceptions":50,"quickness":63,"jerseyNumber":30,"ratings":{"rushing_power":44,"running_speed":38,"maximum_speed":56,"hitting_power":56,"pass_interceptions":50,"quickness":63}},{"id":566,"team_id":18,"name":"Ray Horton","position":"DB","position_detail":"FS","jersey":32,"face":169,"name_rom_offset":8525,"ability_rom_offset":14511,"team_idx":18,"pos_idx":26,"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":56,"pass_interceptions":44,"quickness":38,"jerseyNumber":20,"ratings":{"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":56,"pass_interceptions":44,"quickness":38}},{"id":567,"team_id":18,"name":"James Washington","position":"DB","position_detail":"SS","jersey":55,"face":193,"name_rom_offset":8535,"ability_rom_offset":14515,"team_idx":18,"pos_idx":27,"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":50,"pass_interceptions":50,"quickness":38,"jerseyNumber":37,"ratings":{"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":50,"pass_interceptions":50,"quickness":38}},{"id":568,"team_id":18,"name":"Ken Willis","position":"K","position_detail":"K","jersey":1,"face":66,"name_rom_offset":8551,"ability_rom_offset":14519,"team_idx":18,"pos_idx":28,"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":44,"avoid_kick_block":44,"jerseyNumber":1,"ratings":{"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":44,"avoid_kick_block":44}},{"id":569,"team_id":18,"name":"Mike Saxon","position":"P","position_detail":"P","jersey":4,"face":32,"name_rom_offset":8561,"ability_rom_offset":14523,"team_idx":18,"pos_idx":29,"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":56,"avoid_kick_block":75,"jerseyNumber":4,"ratings":{"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":56,"avoid_kick_block":75}},{"id":570,"team_id":19,"name":"Jim Harbaugh","position":"QB","position_detail":"QB1","jersey":4,"face":29,"name_rom_offset":8571,"ability_rom_offset":14527,"team_idx":19,"pos_idx":0,"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":44,"pass_control":25,"accuracy_of_passing":56,"avoid_pass_block":25,"jerseyNumber":4,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":44,"pass_control":25,"accuracy_of_passing":56,"avoid_pass_block":25}},{"id":571,"team_id":19,"name":"Mike Tomczak","position":"QB","position_detail":"QB2","jersey":24,"face":31,"name_rom_offset":8583,"ability_rom_offset":14532,"team_idx":19,"pos_idx":1,"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":44,"pass_control":31,"accuracy_of_passing":31,"avoid_pass_block":38,"jerseyNumber":18,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":44,"pass_control":31,"accuracy_of_passing":31,"avoid_pass_block":38}},{"id":572,"team_id":19,"name":"Brad Muster","position":"RB","position_detail":"RB1","jersey":37,"face":64,"name_rom_offset":8595,"ability_rom_offset":14537,"team_idx":19,"pos_idx":2,"rushing_power":69,"running_speed":44,"maximum_speed":25,"hitting_power":94,"ball_control":50,"receptions":56,"jerseyNumber":25,"ratings":{"rushing_power":69,"running_speed":44,"maximum_speed":25,"hitting_power":94,"ball_control":50,"receptions":56}},{"id":573,"team_id":19,"name":"Neal Anderson","position":"RB","position_detail":"RB2","jersey":53,"face":136,"name_rom_offset":8606,"ability_rom_offset":14541,"team_idx":19,"pos_idx":3,"rushing_power":69,"running_speed":50,"maximum_speed":63,"hitting_power":50,"ball_control":50,"receptions":50,"jerseyNumber":35,"ratings":{"rushing_power":69,"running_speed":50,"maximum_speed":63,"hitting_power":50,"ball_control":50,"receptions":50}},{"id":574,"team_id":19,"name":"Mark Green","position":"RB","position_detail":"RB3","jersey":49,"face":161,"name_rom_offset":8619,"ability_rom_offset":14545,"team_idx":19,"pos_idx":4,"rushing_power":69,"running_speed":38,"maximum_speed":31,"hitting_power":25,"ball_control":50,"receptions":25,"jerseyNumber":31,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":31,"hitting_power":25,"ball_control":50,"receptions":25}},{"id":575,"team_id":19,"name":"Johnny Bailey","position":"RB","position_detail":"RB4","jersey":34,"face":153,"name_rom_offset":8629,"ability_rom_offset":14549,"team_idx":19,"pos_idx":5,"rushing_power":69,"running_speed":38,"maximum_speed":56,"hitting_power":25,"ball_control":50,"receptions":38,"jerseyNumber":22,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":56,"hitting_power":25,"ball_control":50,"receptions":38}},{"id":576,"team_id":19,"name":"Ron Morris","position":"WR","position_detail":"WR1","jersey":132,"face":183,"name_rom_offset":8642,"ability_rom_offset":14553,"team_idx":19,"pos_idx":6,"rushing_power":69,"running_speed":31,"maximum_speed":31,"hitting_power":13,"ball_control":50,"receptions":50,"jerseyNumber":84,"ratings":{"rushing_power":69,"running_speed":31,"maximum_speed":31,"hitting_power":13,"ball_control":50,"receptions":50}},{"id":577,"team_id":19,"name":"Wendell Davis","position":"WR","position_detail":"WR2","jersey":130,"face":145,"name_rom_offset":8652,"ability_rom_offset":14557,"team_idx":19,"pos_idx":7,"rushing_power":69,"running_speed":31,"maximum_speed":31,"hitting_power":13,"ball_control":50,"receptions":50,"jerseyNumber":82,"ratings":{"rushing_power":69,"running_speed":31,"maximum_speed":31,"hitting_power":13,"ball_control":50,"receptions":50}},{"id":578,"team_id":19,"name":"Glen Kozlowski","position":"WR","position_detail":"WR3","jersey":136,"face":76,"name_rom_offset":8665,"ability_rom_offset":14561,"team_idx":19,"pos_idx":8,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":13,"ball_control":50,"receptions":44,"jerseyNumber":88,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":13,"ball_control":50,"receptions":44}},{"id":579,"team_id":19,"name":"Dennis Gentry","position":"WR","position_detail":"WR4","jersey":41,"face":156,"name_rom_offset":8679,"ability_rom_offset":14565,"team_idx":19,"pos_idx":9,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":13,"ball_control":50,"receptions":50,"jerseyNumber":29,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":13,"ball_control":50,"receptions":50}},{"id":580,"team_id":19,"name":"James Thornton","position":"TE","position_detail":"TE1","jersey":128,"face":33,"name_rom_offset":8692,"ability_rom_offset":14569,"team_idx":19,"pos_idx":10,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":63,"ball_control":50,"receptions":25,"jerseyNumber":80,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":63,"ball_control":50,"receptions":25}},{"id":581,"team_id":19,"name":"Cap Boso","position":"TE","position_detail":"TE2","jersey":134,"face":51,"name_rom_offset":8706,"ability_rom_offset":14573,"team_idx":19,"pos_idx":11,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":44,"ball_control":50,"receptions":31,"jerseyNumber":86,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":44,"ball_control":50,"receptions":31}},{"id":582,"team_id":19,"name":"Jay Hilgenberg","position":"OL","position_detail":"C","jersey":99,"face":72,"name_rom_offset":8714,"ability_rom_offset":14577,"team_idx":19,"pos_idx":12,"rushing_power":69,"running_speed":25,"maximum_speed":50,"hitting_power":63,"jerseyNumber":63,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":50,"hitting_power":63}},{"id":583,"team_id":19,"name":"Mark Bortz","position":"OL","position_detail":"LG","jersey":98,"face":63,"name_rom_offset":8728,"ability_rom_offset":14580,"team_idx":19,"pos_idx":13,"rushing_power":69,"running_speed":25,"maximum_speed":44,"hitting_power":69,"jerseyNumber":62,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":44,"hitting_power":69}},{"id":584,"team_id":19,"name":"Tom Thayer","position":"OL","position_detail":"RG","jersey":87,"face":54,"name_rom_offset":8738,"ability_rom_offset":14583,"team_idx":19,"pos_idx":14,"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":50,"jerseyNumber":57,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":50}},{"id":585,"team_id":19,"name":"Jim Covert","position":"OL","position_detail":"LT","jersey":116,"face":81,"name_rom_offset":8748,"ability_rom_offset":14586,"team_idx":19,"pos_idx":15,"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":50,"jerseyNumber":74,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":50}},{"id":586,"team_id":19,"name":"Keith Van Horne","position":"OL","position_detail":"RT","jersey":120,"face":19,"name_rom_offset":8758,"ability_rom_offset":14589,"team_idx":19,"pos_idx":16,"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":50,"jerseyNumber":78,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":50}},{"id":587,"team_id":19,"name":"Richard Dent","position":"DL","position_detail":"RE","jersey":149,"face":165,"name_rom_offset":8773,"ability_rom_offset":14592,"team_idx":19,"pos_idx":17,"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":63,"pass_interceptions":44,"quickness":75,"jerseyNumber":95,"ratings":{"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":63,"pass_interceptions":44,"quickness":75}},{"id":588,"team_id":19,"name":"William Perry","position":"DL","position_detail":"NT","jersey":114,"face":206,"name_rom_offset":8785,"ability_rom_offset":14596,"team_idx":19,"pos_idx":18,"rushing_power":31,"running_speed":38,"maximum_speed":19,"hitting_power":69,"pass_interceptions":19,"quickness":56,"jerseyNumber":72,"ratings":{"rushing_power":31,"running_speed":38,"maximum_speed":19,"hitting_power":69,"pass_interceptions":19,"quickness":56}},{"id":589,"team_id":19,"name":"Trace Armstrong","position":"DL","position_detail":"LE","jersey":147,"face":79,"name_rom_offset":8798,"ability_rom_offset":14600,"team_idx":19,"pos_idx":19,"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":63,"pass_interceptions":19,"quickness":69,"jerseyNumber":93,"ratings":{"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":63,"pass_interceptions":19,"quickness":69}},{"id":590,"team_id":19,"name":"Jim Morrissey","position":"LB","position_detail":"ROLB","jersey":81,"face":12,"name_rom_offset":8813,"ability_rom_offset":14604,"team_idx":19,"pos_idx":20,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":44,"pass_interceptions":31,"quickness":44,"jerseyNumber":51,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":44,"pass_interceptions":31,"quickness":44}},{"id":591,"team_id":19,"name":"Dan Hampton","position":"LB","position_detail":"RILB","jersey":153,"face":42,"name_rom_offset":8826,"ability_rom_offset":14608,"team_idx":19,"pos_idx":21,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":56,"pass_interceptions":19,"quickness":63,"jerseyNumber":99,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":56,"pass_interceptions":19,"quickness":63}},{"id":592,"team_id":19,"name":"Mike Singletary","position":"LB","position_detail":"LILB","jersey":80,"face":166,"name_rom_offset":8837,"ability_rom_offset":14612,"team_idx":19,"pos_idx":22,"rushing_power":50,"running_speed":38,"maximum_speed":56,"hitting_power":75,"pass_interceptions":19,"quickness":81,"jerseyNumber":50,"ratings":{"rushing_power":50,"running_speed":38,"maximum_speed":56,"hitting_power":75,"pass_interceptions":19,"quickness":81}},{"id":593,"team_id":19,"name":"Ron Rivera","position":"LB","position_detail":"LOLB","jersey":89,"face":30,"name_rom_offset":8852,"ability_rom_offset":14616,"team_idx":19,"pos_idx":23,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":44,"pass_interceptions":31,"quickness":44,"jerseyNumber":59,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":44,"pass_interceptions":31,"quickness":44}},{"id":594,"team_id":19,"name":"Lemuel Stinson","position":"DB","position_detail":"RCB","jersey":50,"face":196,"name_rom_offset":8862,"ability_rom_offset":14620,"team_idx":19,"pos_idx":24,"rushing_power":44,"running_speed":38,"maximum_speed":56,"hitting_power":50,"pass_interceptions":69,"quickness":56,"jerseyNumber":32,"ratings":{"rushing_power":44,"running_speed":38,"maximum_speed":56,"hitting_power":50,"pass_interceptions":69,"quickness":56}},{"id":595,"team_id":19,"name":"Donnell Woolford","position":"DB","position_detail":"LCB","jersey":33,"face":193,"name_rom_offset":8876,"ability_rom_offset":14624,"team_idx":19,"pos_idx":25,"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":44,"pass_interceptions":63,"quickness":63,"jerseyNumber":21,"ratings":{"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":44,"pass_interceptions":63,"quickness":63}},{"id":596,"team_id":19,"name":"Mark Carrier","position":"DB","position_detail":"FS","jersey":32,"face":201,"name_rom_offset":8892,"ability_rom_offset":14628,"team_idx":19,"pos_idx":26,"rushing_power":44,"running_speed":38,"maximum_speed":56,"hitting_power":50,"pass_interceptions":81,"quickness":69,"jerseyNumber":20,"ratings":{"rushing_power":44,"running_speed":38,"maximum_speed":56,"hitting_power":50,"pass_interceptions":81,"quickness":69}},{"id":597,"team_id":19,"name":"Shaun Gayle","position":"DB","position_detail":"SS","jersey":35,"face":162,"name_rom_offset":8904,"ability_rom_offset":14632,"team_idx":19,"pos_idx":27,"rushing_power":31,"running_speed":25,"maximum_speed":44,"hitting_power":44,"pass_interceptions":56,"quickness":44,"jerseyNumber":23,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":44,"hitting_power":44,"pass_interceptions":56,"quickness":44}},{"id":598,"team_id":19,"name":"Kevin Butler","position":"K","position_detail":"K","jersey":6,"face":50,"name_rom_offset":8915,"ability_rom_offset":14636,"team_idx":19,"pos_idx":28,"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":38,"avoid_kick_block":50,"jerseyNumber":6,"ratings":{"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":38,"avoid_kick_block":50}},{"id":599,"team_id":19,"name":"Maury Buford","position":"P","position_detail":"P","jersey":8,"face":35,"name_rom_offset":8927,"ability_rom_offset":14640,"team_idx":19,"pos_idx":29,"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":31,"avoid_kick_block":25,"jerseyNumber":8,"ratings":{"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":31,"avoid_kick_block":25}},{"id":600,"team_id":20,"name":"Rodney Peete","position":"QB","position_detail":"QB1","jersey":9,"face":171,"name_rom_offset":8939,"ability_rom_offset":14644,"team_idx":20,"pos_idx":0,"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":13,"passing_speed":38,"pass_control":44,"accuracy_of_passing":31,"avoid_pass_block":25,"jerseyNumber":9,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":13,"passing_speed":38,"pass_control":44,"accuracy_of_passing":31,"avoid_pass_block":25}},{"id":601,"team_id":20,"name":"Andre Ware","position":"QB","position_detail":"QB2","jersey":17,"face":146,"name_rom_offset":8951,"ability_rom_offset":14649,"team_idx":20,"pos_idx":1,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"passing_speed":44,"pass_control":38,"accuracy_of_passing":31,"avoid_pass_block":44,"jerseyNumber":11,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"passing_speed":44,"pass_control":38,"accuracy_of_passing":31,"avoid_pass_block":44}},{"id":602,"team_id":20,"name":"Barry Sanders","position":"RB","position_detail":"RB1","jersey":32,"face":155,"name_rom_offset":8961,"ability_rom_offset":14654,"team_idx":20,"pos_idx":2,"rushing_power":69,"running_speed":38,"maximum_speed":69,"hitting_power":25,"ball_control":69,"receptions":44,"jerseyNumber":20,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":69,"hitting_power":25,"ball_control":69,"receptions":44}},{"id":603,"team_id":20,"name":"Aubrey Matthews","position":"RB","position_detail":"RB2","jersey":131,"face":173,"name_rom_offset":8974,"ability_rom_offset":14658,"team_idx":20,"pos_idx":3,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":13,"ball_control":50,"receptions":50,"jerseyNumber":83,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":13,"ball_control":50,"receptions":50}},{"id":604,"team_id":20,"name":"James Wilder","position":"RB","position_detail":"RB3","jersey":52,"face":152,"name_rom_offset":8989,"ability_rom_offset":14662,"team_idx":20,"pos_idx":4,"rushing_power":69,"running_speed":44,"maximum_speed":31,"hitting_power":25,"ball_control":50,"receptions":25,"jerseyNumber":34,"ratings":{"rushing_power":69,"running_speed":44,"maximum_speed":31,"hitting_power":25,"ball_control":50,"receptions":25}},{"id":605,"team_id":20,"name":"Mel Gray","position":"RB","position_detail":"RB4","jersey":35,"face":134,"name_rom_offset":9001,"ability_rom_offset":14666,"team_idx":20,"pos_idx":5,"rushing_power":69,"running_speed":38,"maximum_speed":56,"hitting_power":19,"ball_control":50,"receptions":50,"jerseyNumber":23,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":56,"hitting_power":19,"ball_control":50,"receptions":50}},{"id":606,"team_id":20,"name":"Richard Johnson","position":"WR","position_detail":"WR1","jersey":132,"face":184,"name_rom_offset":9009,"ability_rom_offset":14670,"team_idx":20,"pos_idx":6,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":13,"ball_control":50,"receptions":75,"jerseyNumber":84,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":13,"ball_control":50,"receptions":75}},{"id":607,"team_id":20,"name":"Robert Clark","position":"WR","position_detail":"WR2","jersey":130,"face":161,"name_rom_offset":9024,"ability_rom_offset":14674,"team_idx":20,"pos_idx":7,"rushing_power":69,"running_speed":38,"maximum_speed":44,"hitting_power":13,"ball_control":50,"receptions":69,"jerseyNumber":82,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":44,"hitting_power":13,"ball_control":50,"receptions":69}},{"id":608,"team_id":20,"name":"Willie Green","position":"WR","position_detail":"WR3","jersey":134,"face":205,"name_rom_offset":9036,"ability_rom_offset":14678,"team_idx":20,"pos_idx":8,"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":13,"ball_control":50,"receptions":31,"jerseyNumber":86,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":13,"ball_control":50,"receptions":31}},{"id":609,"team_id":20,"name":"Jeff Campbell","position":"WR","position_detail":"WR4","jersey":135,"face":33,"name_rom_offset":9048,"ability_rom_offset":14682,"team_idx":20,"pos_idx":9,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":44,"jerseyNumber":87,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":44}},{"id":610,"team_id":20,"name":"Terry Greer","position":"TE","position_detail":"TE1","jersey":137,"face":164,"name_rom_offset":9061,"ability_rom_offset":14686,"team_idx":20,"pos_idx":10,"rushing_power":69,"running_speed":31,"maximum_speed":31,"hitting_power":13,"ball_control":50,"receptions":44,"jerseyNumber":89,"ratings":{"rushing_power":69,"running_speed":31,"maximum_speed":31,"hitting_power":13,"ball_control":50,"receptions":44}},{"id":611,"team_id":20,"name":"Mike Farr","position":"TE","position_detail":"TE2","jersey":129,"face":209,"name_rom_offset":9072,"ability_rom_offset":14690,"team_idx":20,"pos_idx":11,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":44,"jerseyNumber":81,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":44}},{"id":612,"team_id":20,"name":"Kevin Glover","position":"OL","position_detail":"C","jersey":83,"face":175,"name_rom_offset":9081,"ability_rom_offset":14694,"team_idx":20,"pos_idx":12,"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":44,"jerseyNumber":53,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":44}},{"id":613,"team_id":20,"name":"Eric Andolsek","position":"OL","position_detail":"LG","jersey":101,"face":27,"name_rom_offset":9093,"ability_rom_offset":14697,"team_idx":20,"pos_idx":13,"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":50,"jerseyNumber":65,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":50}},{"id":614,"team_id":20,"name":"Ken Dallafior","position":"OL","position_detail":"RG","jersey":103,"face":36,"name_rom_offset":9106,"ability_rom_offset":14700,"team_idx":20,"pos_idx":14,"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":38,"jerseyNumber":67,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":38}},{"id":615,"team_id":20,"name":"Lomas Brown","position":"OL","position_detail":"LT","jersey":117,"face":141,"name_rom_offset":9119,"ability_rom_offset":14703,"team_idx":20,"pos_idx":15,"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":56,"jerseyNumber":75,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":56}},{"id":616,"team_id":20,"name":"Harvey Salem","position":"OL","position_detail":"RT","jersey":115,"face":12,"name_rom_offset":9130,"ability_rom_offset":14706,"team_idx":20,"pos_idx":16,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":50,"jerseyNumber":73,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":50}},{"id":617,"team_id":20,"name":"Dan Owens","position":"DL","position_detail":"RE","jersey":112,"face":35,"name_rom_offset":9142,"ability_rom_offset":14709,"team_idx":20,"pos_idx":17,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":56,"pass_interceptions":19,"quickness":56,"jerseyNumber":70,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":56,"pass_interceptions":19,"quickness":56}},{"id":618,"team_id":20,"name":"Jerry Ball","position":"DL","position_detail":"NT","jersey":147,"face":167,"name_rom_offset":9151,"ability_rom_offset":14713,"team_idx":20,"pos_idx":18,"rushing_power":44,"running_speed":31,"maximum_speed":44,"hitting_power":69,"pass_interceptions":19,"quickness":69,"jerseyNumber":93,"ratings":{"rushing_power":44,"running_speed":31,"maximum_speed":44,"hitting_power":69,"pass_interceptions":19,"quickness":69}},{"id":619,"team_id":20,"name":"Keith Ferguson","position":"DL","position_detail":"LE","jersey":119,"face":199,"name_rom_offset":9161,"ability_rom_offset":14717,"team_idx":20,"pos_idx":19,"rushing_power":31,"running_speed":25,"maximum_speed":25,"hitting_power":31,"pass_interceptions":19,"quickness":31,"jerseyNumber":77,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":25,"hitting_power":31,"pass_interceptions":19,"quickness":31}},{"id":620,"team_id":20,"name":"Michael Cofer","position":"LB","position_detail":"ROLB","jersey":85,"face":191,"name_rom_offset":9175,"ability_rom_offset":14721,"team_idx":20,"pos_idx":20,"rushing_power":50,"running_speed":38,"maximum_speed":56,"hitting_power":50,"pass_interceptions":31,"quickness":56,"jerseyNumber":55,"ratings":{"rushing_power":50,"running_speed":38,"maximum_speed":56,"hitting_power":50,"pass_interceptions":31,"quickness":56}},{"id":621,"team_id":20,"name":"Dennis Gibson","position":"LB","position_detail":"RILB","jersey":152,"face":68,"name_rom_offset":9188,"ability_rom_offset":14725,"team_idx":20,"pos_idx":21,"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":31,"pass_interceptions":19,"quickness":25,"jerseyNumber":98,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":31,"pass_interceptions":19,"quickness":25}},{"id":622,"team_id":20,"name":"Chris Spielman","position":"LB","position_detail":"LILB","jersey":84,"face":48,"name_rom_offset":9201,"ability_rom_offset":14729,"team_idx":20,"pos_idx":22,"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":56,"pass_interceptions":19,"quickness":50,"jerseyNumber":54,"ratings":{"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":56,"pass_interceptions":19,"quickness":50}},{"id":623,"team_id":20,"name":"George Jamison","position":"LB","position_detail":"LOLB","jersey":88,"face":150,"name_rom_offset":9215,"ability_rom_offset":14733,"team_idx":20,"pos_idx":23,"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":25,"pass_interceptions":19,"quickness":25,"jerseyNumber":58,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":25,"pass_interceptions":19,"quickness":25}},{"id":624,"team_id":20,"name":"Leroy Irvin","position":"DB","position_detail":"RCB","jersey":71,"face":190,"name_rom_offset":9229,"ability_rom_offset":14737,"team_idx":20,"pos_idx":24,"rushing_power":31,"running_speed":25,"maximum_speed":25,"hitting_power":25,"pass_interceptions":38,"quickness":50,"jerseyNumber":47,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":25,"hitting_power":25,"pass_interceptions":38,"quickness":50}},{"id":625,"team_id":20,"name":"Ray Crockett","position":"DB","position_detail":"LCB","jersey":57,"face":162,"name_rom_offset":9240,"ability_rom_offset":14741,"team_idx":20,"pos_idx":25,"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":50,"pass_interceptions":50,"quickness":50,"jerseyNumber":39,"ratings":{"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":50,"pass_interceptions":50,"quickness":50}},{"id":626,"team_id":20,"name":"Bennie Blades","position":"DB","position_detail":"FS","jersey":54,"face":176,"name_rom_offset":9252,"ability_rom_offset":14745,"team_idx":20,"pos_idx":26,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":50,"pass_interceptions":44,"quickness":38,"jerseyNumber":36,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":50,"pass_interceptions":44,"quickness":38}},{"id":627,"team_id":20,"name":"William White","position":"DB","position_detail":"SS","jersey":53,"face":192,"name_rom_offset":9265,"ability_rom_offset":14749,"team_idx":20,"pos_idx":27,"rushing_power":44,"running_speed":38,"maximum_speed":56,"hitting_power":56,"pass_interceptions":56,"quickness":56,"jerseyNumber":35,"ratings":{"rushing_power":44,"running_speed":38,"maximum_speed":56,"hitting_power":56,"pass_interceptions":56,"quickness":56}},{"id":628,"team_id":20,"name":"Eddie Murray","position":"K","position_detail":"K","jersey":3,"face":46,"name_rom_offset":9278,"ability_rom_offset":14753,"team_idx":20,"pos_idx":28,"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":31,"avoid_kick_block":50,"jerseyNumber":3,"ratings":{"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":31,"avoid_kick_block":50}},{"id":629,"team_id":20,"name":"Jim Arnold","position":"P","position_detail":"P","jersey":6,"face":7,"name_rom_offset":9290,"ability_rom_offset":14757,"team_idx":20,"pos_idx":29,"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":50,"avoid_kick_block":56,"jerseyNumber":6,"ratings":{"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":50,"avoid_kick_block":56}},{"id":630,"team_id":21,"name":"Don Majkowski","position":"QB","position_detail":"QB1","jersey":7,"face":63,"name_rom_offset":9300,"ability_rom_offset":14761,"team_idx":21,"pos_idx":0,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"passing_speed":38,"pass_control":50,"accuracy_of_passing":50,"avoid_pass_block":50,"jerseyNumber":7,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"passing_speed":38,"pass_control":50,"accuracy_of_passing":50,"avoid_pass_block":50}},{"id":631,"team_id":21,"name":"Anthony Dilweg","position":"QB","position_detail":"QB2","jersey":8,"face":8,"name_rom_offset":9313,"ability_rom_offset":14766,"team_idx":21,"pos_idx":1,"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":44,"pass_control":38,"accuracy_of_passing":31,"avoid_pass_block":38,"jerseyNumber":8,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":44,"pass_control":38,"accuracy_of_passing":31,"avoid_pass_block":38}},{"id":632,"team_id":21,"name":"Keith Woodside","position":"RB","position_detail":"RB1","jersey":51,"face":134,"name_rom_offset":9327,"ability_rom_offset":14771,"team_idx":21,"pos_idx":2,"rushing_power":69,"running_speed":38,"maximum_speed":44,"hitting_power":31,"ball_control":50,"receptions":31,"jerseyNumber":33,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":44,"hitting_power":31,"ball_control":50,"receptions":31}},{"id":633,"team_id":21,"name":"Michael Haddix","position":"RB","position_detail":"RB2","jersey":53,"face":152,"name_rom_offset":9341,"ability_rom_offset":14775,"team_idx":21,"pos_idx":3,"rushing_power":69,"running_speed":38,"maximum_speed":25,"hitting_power":94,"ball_control":50,"receptions":25,"jerseyNumber":35,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":25,"hitting_power":94,"ball_control":50,"receptions":25}},{"id":634,"team_id":21,"name":"Darrell Thompson","position":"RB","position_detail":"RB3","jersey":57,"face":157,"name_rom_offset":9355,"ability_rom_offset":14779,"team_idx":21,"pos_idx":4,"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":31,"ball_control":50,"receptions":19,"jerseyNumber":39,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":31,"ball_control":50,"receptions":19}},{"id":635,"team_id":21,"name":"Herman Fontenot","position":"RB","position_detail":"RB4","jersey":39,"face":139,"name_rom_offset":9371,"ability_rom_offset":14783,"team_idx":21,"pos_idx":5,"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":25,"ball_control":50,"receptions":38,"jerseyNumber":27,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":25,"ball_control":50,"receptions":38}},{"id":636,"team_id":21,"name":"Sterling Sharpe","position":"WR","position_detail":"WR1","jersey":132,"face":150,"name_rom_offset":9386,"ability_rom_offset":14787,"team_idx":21,"pos_idx":6,"rushing_power":69,"running_speed":38,"maximum_speed":50,"hitting_power":13,"ball_control":50,"receptions":75,"jerseyNumber":84,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":50,"hitting_power":13,"ball_control":50,"receptions":75}},{"id":637,"team_id":21,"name":"Perry Kemp","position":"WR","position_detail":"WR2","jersey":129,"face":130,"name_rom_offset":9401,"ability_rom_offset":14791,"team_idx":21,"pos_idx":7,"rushing_power":69,"running_speed":31,"maximum_speed":31,"hitting_power":13,"ball_control":50,"receptions":50,"jerseyNumber":81,"ratings":{"rushing_power":69,"running_speed":31,"maximum_speed":31,"hitting_power":13,"ball_control":50,"receptions":50}},{"id":638,"team_id":21,"name":"Charles Wilson","position":"WR","position_detail":"WR3","jersey":136,"face":164,"name_rom_offset":9411,"ability_rom_offset":14795,"team_idx":21,"pos_idx":8,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":50,"jerseyNumber":88,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":50}},{"id":639,"team_id":21,"name":"Jeff Query","position":"WR","position_detail":"WR4","jersey":133,"face":57,"name_rom_offset":9425,"ability_rom_offset":14799,"team_idx":21,"pos_idx":9,"rushing_power":69,"running_speed":31,"maximum_speed":31,"hitting_power":13,"ball_control":50,"receptions":50,"jerseyNumber":85,"ratings":{"rushing_power":69,"running_speed":31,"maximum_speed":31,"hitting_power":13,"ball_control":50,"receptions":50}},{"id":640,"team_id":21,"name":"Ed West","position":"TE","position_detail":"TE1","jersey":134,"face":194,"name_rom_offset":9435,"ability_rom_offset":14803,"team_idx":21,"pos_idx":10,"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":50,"ball_control":50,"receptions":38,"jerseyNumber":86,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":50,"ball_control":50,"receptions":38}},{"id":641,"team_id":21,"name":"Jackie Harris","position":"TE","position_detail":"TE2","jersey":128,"face":154,"name_rom_offset":9442,"ability_rom_offset":14807,"team_idx":21,"pos_idx":11,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":44,"ball_control":50,"receptions":31,"jerseyNumber":80,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":44,"ball_control":50,"receptions":31}},{"id":642,"team_id":21,"name":"James Campen","position":"OL","position_detail":"C","jersey":99,"face":47,"name_rom_offset":9455,"ability_rom_offset":14811,"team_idx":21,"pos_idx":12,"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":38,"jerseyNumber":63,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":38}},{"id":643,"team_id":21,"name":"Rich Moran","position":"OL","position_detail":"LG","jersey":87,"face":48,"name_rom_offset":9467,"ability_rom_offset":14814,"team_idx":21,"pos_idx":13,"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":44,"jerseyNumber":57,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":44}},{"id":644,"team_id":21,"name":"Ron Hallstrom","position":"OL","position_detail":"RG","jersey":101,"face":12,"name_rom_offset":9477,"ability_rom_offset":14817,"team_idx":21,"pos_idx":14,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":50,"jerseyNumber":65,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":50}},{"id":645,"team_id":21,"name":"Alan Veingrad","position":"OL","position_detail":"LT","jersey":115,"face":51,"name_rom_offset":9490,"ability_rom_offset":14820,"team_idx":21,"pos_idx":15,"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":44,"jerseyNumber":73,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":44}},{"id":646,"team_id":21,"name":"Tony Mandarich","position":"OL","position_detail":"RT","jersey":119,"face":58,"name_rom_offset":9503,"ability_rom_offset":14823,"team_idx":21,"pos_idx":16,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":63,"jerseyNumber":77,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":63}},{"id":647,"team_id":21,"name":"Robert Brown","position":"DL","position_detail":"RE","jersey":147,"face":168,"name_rom_offset":9517,"ability_rom_offset":14826,"team_idx":21,"pos_idx":17,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":19,"quickness":44,"jerseyNumber":93,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":19,"quickness":44}},{"id":648,"team_id":21,"name":"Bob Nelson","position":"DL","position_detail":"NT","jersey":121,"face":49,"name_rom_offset":9529,"ability_rom_offset":14830,"team_idx":21,"pos_idx":18,"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":56,"pass_interceptions":19,"quickness":56,"jerseyNumber":79,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":56,"pass_interceptions":19,"quickness":56}},{"id":649,"team_id":21,"name":"Matt Brock","position":"DL","position_detail":"LE","jersey":98,"face":9,"name_rom_offset":9539,"ability_rom_offset":14834,"team_idx":21,"pos_idx":19,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":44,"pass_interceptions":19,"quickness":44,"jerseyNumber":62,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":44,"pass_interceptions":19,"quickness":44}},{"id":650,"team_id":21,"name":"Tim Harris","position":"LB","position_detail":"ROLB","jersey":151,"face":153,"name_rom_offset":9549,"ability_rom_offset":14838,"team_idx":21,"pos_idx":20,"rushing_power":50,"running_speed":38,"maximum_speed":56,"hitting_power":50,"pass_interceptions":19,"quickness":63,"jerseyNumber":97,"ratings":{"rushing_power":50,"running_speed":38,"maximum_speed":56,"hitting_power":50,"pass_interceptions":19,"quickness":63}},{"id":651,"team_id":21,"name":"Johnny Holland","position":"LB","position_detail":"RILB","jersey":80,"face":198,"name_rom_offset":9559,"ability_rom_offset":14842,"team_idx":21,"pos_idx":21,"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":31,"pass_interceptions":31,"quickness":25,"jerseyNumber":50,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":31,"pass_interceptions":31,"quickness":25}},{"id":652,"team_id":21,"name":"Brian Noble","position":"LB","position_detail":"LILB","jersey":145,"face":79,"name_rom_offset":9573,"ability_rom_offset":14846,"team_idx":21,"pos_idx":22,"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":31,"pass_interceptions":19,"quickness":31,"jerseyNumber":91,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":31,"pass_interceptions":19,"quickness":31}},{"id":653,"team_id":21,"name":"Scott Stephen","position":"LB","position_detail":"LOLB","jersey":84,"face":135,"name_rom_offset":9584,"ability_rom_offset":14850,"team_idx":21,"pos_idx":23,"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":31,"pass_interceptions":38,"quickness":31,"jerseyNumber":54,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":31,"pass_interceptions":38,"quickness":31}},{"id":654,"team_id":21,"name":"Jerry Holmes","position":"DB","position_detail":"RCB","jersey":68,"face":131,"name_rom_offset":9597,"ability_rom_offset":14854,"team_idx":21,"pos_idx":24,"rushing_power":31,"running_speed":25,"maximum_speed":44,"hitting_power":38,"pass_interceptions":50,"quickness":38,"jerseyNumber":44,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":44,"hitting_power":38,"pass_interceptions":50,"quickness":38}},{"id":655,"team_id":21,"name":"Mark Lee","position":"DB","position_detail":"LCB","jersey":34,"face":201,"name_rom_offset":9609,"ability_rom_offset":14858,"team_idx":21,"pos_idx":25,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":31,"quickness":31,"jerseyNumber":22,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":31,"quickness":31}},{"id":656,"team_id":21,"name":"Chuck Cecil","position":"DB","position_detail":"FS","jersey":38,"face":66,"name_rom_offset":9617,"ability_rom_offset":14862,"team_idx":21,"pos_idx":26,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":44,"pass_interceptions":38,"quickness":31,"jerseyNumber":26,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":44,"pass_interceptions":38,"quickness":31}},{"id":657,"team_id":21,"name":"Mark Murphy","position":"DB","position_detail":"SS","jersey":55,"face":55,"name_rom_offset":9628,"ability_rom_offset":14866,"team_idx":21,"pos_idx":27,"rushing_power":31,"running_speed":25,"maximum_speed":44,"hitting_power":44,"pass_interceptions":50,"quickness":38,"jerseyNumber":37,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":44,"hitting_power":44,"pass_interceptions":50,"quickness":38}},{"id":658,"team_id":21,"name":"Chris Jacke","position":"K","position_detail":"K","jersey":19,"face":35,"name_rom_offset":9639,"ability_rom_offset":14870,"team_idx":21,"pos_idx":28,"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":56,"avoid_kick_block":38,"jerseyNumber":13,"ratings":{"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":56,"avoid_kick_block":38}},{"id":659,"team_id":21,"name":"Don Bracken","position":"P","position_detail":"P","jersey":23,"face":44,"name_rom_offset":9650,"ability_rom_offset":14874,"team_idx":21,"pos_idx":29,"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":25,"avoid_kick_block":50,"jerseyNumber":17,"ratings":{"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":25,"avoid_kick_block":50}},{"id":660,"team_id":22,"name":"Wade Wilson","position":"QB","position_detail":"QB1","jersey":17,"face":33,"name_rom_offset":9661,"ability_rom_offset":14878,"team_idx":22,"pos_idx":0,"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":44,"pass_control":44,"accuracy_of_passing":44,"avoid_pass_block":38,"jerseyNumber":11,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":44,"pass_control":44,"accuracy_of_passing":44,"avoid_pass_block":38}},{"id":661,"team_id":22,"name":"Rich Gannon","position":"QB","position_detail":"QB2","jersey":22,"face":34,"name_rom_offset":9672,"ability_rom_offset":14883,"team_idx":22,"pos_idx":1,"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":25,"pass_control":38,"accuracy_of_passing":25,"avoid_pass_block":31,"jerseyNumber":16,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":25,"pass_control":38,"accuracy_of_passing":25,"avoid_pass_block":31}},{"id":662,"team_id":22,"name":"Herschel Walker","position":"RB","position_detail":"RB1","jersey":52,"face":128,"name_rom_offset":9683,"ability_rom_offset":14888,"team_idx":22,"pos_idx":2,"rushing_power":69,"running_speed":38,"maximum_speed":44,"hitting_power":63,"ball_control":50,"receptions":44,"jerseyNumber":34,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":44,"hitting_power":63,"ball_control":50,"receptions":44}},{"id":663,"team_id":22,"name":"Rick Fenney","position":"RB","position_detail":"RB2","jersey":49,"face":43,"name_rom_offset":9698,"ability_rom_offset":14892,"team_idx":22,"pos_idx":3,"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":38,"ball_control":50,"receptions":25,"jerseyNumber":31,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":38,"ball_control":50,"receptions":25}},{"id":664,"team_id":22,"name":"Jessie Clark","position":"RB","position_detail":"RB3","jersey":51,"face":139,"name_rom_offset":9709,"ability_rom_offset":14896,"team_idx":22,"pos_idx":4,"rushing_power":69,"running_speed":38,"maximum_speed":31,"hitting_power":31,"ball_control":50,"receptions":25,"jerseyNumber":33,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":31,"hitting_power":31,"ball_control":50,"receptions":25}},{"id":665,"team_id":22,"name":"Alfred Anderson","position":"RB","position_detail":"RB4","jersey":70,"face":141,"name_rom_offset":9721,"ability_rom_offset":14900,"team_idx":22,"pos_idx":5,"rushing_power":69,"running_speed":38,"maximum_speed":31,"hitting_power":31,"ball_control":50,"receptions":25,"jerseyNumber":46,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":31,"hitting_power":31,"ball_control":50,"receptions":25}},{"id":666,"team_id":22,"name":"Hassan Jones","position":"WR","position_detail":"WR1","jersey":132,"face":192,"name_rom_offset":9736,"ability_rom_offset":14904,"team_idx":22,"pos_idx":6,"rushing_power":69,"running_speed":31,"maximum_speed":31,"hitting_power":13,"ball_control":50,"receptions":63,"jerseyNumber":84,"ratings":{"rushing_power":69,"running_speed":31,"maximum_speed":31,"hitting_power":13,"ball_control":50,"receptions":63}},{"id":667,"team_id":22,"name":"Anthony Carter","position":"WR","position_detail":"WR2","jersey":129,"face":159,"name_rom_offset":9748,"ability_rom_offset":14908,"team_idx":22,"pos_idx":7,"rushing_power":69,"running_speed":44,"maximum_speed":56,"hitting_power":13,"ball_control":50,"receptions":75,"jerseyNumber":81,"ratings":{"rushing_power":69,"running_speed":44,"maximum_speed":56,"hitting_power":13,"ball_control":50,"receptions":75}},{"id":668,"team_id":22,"name":"Leo Lewis","position":"WR","position_detail":"WR3","jersey":135,"face":198,"name_rom_offset":9762,"ability_rom_offset":14912,"team_idx":22,"pos_idx":8,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":13,"ball_control":50,"receptions":44,"jerseyNumber":87,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":13,"ball_control":50,"receptions":44}},{"id":669,"team_id":22,"name":"Cris Carter","position":"WR","position_detail":"WR4","jersey":128,"face":143,"name_rom_offset":9771,"ability_rom_offset":14916,"team_idx":22,"pos_idx":9,"rushing_power":69,"running_speed":31,"maximum_speed":31,"hitting_power":13,"ball_control":50,"receptions":50,"jerseyNumber":80,"ratings":{"rushing_power":69,"running_speed":31,"maximum_speed":31,"hitting_power":13,"ball_control":50,"receptions":50}},{"id":670,"team_id":22,"name":"Steve Jordan","position":"TE","position_detail":"TE1","jersey":131,"face":183,"name_rom_offset":9782,"ability_rom_offset":14920,"team_idx":22,"pos_idx":10,"rushing_power":69,"running_speed":25,"maximum_speed":44,"hitting_power":63,"ball_control":50,"receptions":56,"jerseyNumber":83,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":44,"hitting_power":63,"ball_control":50,"receptions":56}},{"id":671,"team_id":22,"name":"Mike Jones","position":"TE","position_detail":"TE2","jersey":130,"face":205,"name_rom_offset":9794,"ability_rom_offset":14924,"team_idx":22,"pos_idx":11,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":50,"ball_control":50,"receptions":25,"jerseyNumber":82,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":50,"ball_control":50,"receptions":25}},{"id":672,"team_id":22,"name":"Kirk Lowdermilk","position":"OL","position_detail":"C","jersey":99,"face":11,"name_rom_offset":9804,"ability_rom_offset":14928,"team_idx":22,"pos_idx":12,"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":63,"jerseyNumber":63,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":63}},{"id":673,"team_id":22,"name":"Randall Mcdaniel","position":"OL","position_detail":"LG","jersey":100,"face":194,"name_rom_offset":9819,"ability_rom_offset":14931,"team_idx":22,"pos_idx":13,"rushing_power":69,"running_speed":25,"maximum_speed":50,"hitting_power":69,"jerseyNumber":64,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":50,"hitting_power":69}},{"id":674,"team_id":22,"name":"Todd Kalis","position":"OL","position_detail":"RG","jersey":105,"face":42,"name_rom_offset":9835,"ability_rom_offset":14934,"team_idx":22,"pos_idx":14,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":50,"jerseyNumber":69,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":50}},{"id":675,"team_id":22,"name":"Gary Zimmerman","position":"OL","position_detail":"LT","jersey":101,"face":65,"name_rom_offset":9845,"ability_rom_offset":14937,"team_idx":22,"pos_idx":15,"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":69,"jerseyNumber":65,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":69}},{"id":676,"team_id":22,"name":"Tim Irwin","position":"OL","position_detail":"RT","jersey":118,"face":43,"name_rom_offset":9859,"ability_rom_offset":14940,"team_idx":22,"pos_idx":16,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":50,"jerseyNumber":76,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":50}},{"id":677,"team_id":22,"name":"Chris Doleman","position":"DL","position_detail":"RE","jersey":86,"face":148,"name_rom_offset":9868,"ability_rom_offset":14943,"team_idx":22,"pos_idx":17,"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":69,"pass_interceptions":31,"quickness":69,"jerseyNumber":56,"ratings":{"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":69,"pass_interceptions":31,"quickness":69}},{"id":678,"team_id":22,"name":"Henry Thomas","position":"DL","position_detail":"NT","jersey":151,"face":185,"name_rom_offset":9881,"ability_rom_offset":14947,"team_idx":22,"pos_idx":18,"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":50,"pass_interceptions":19,"quickness":63,"jerseyNumber":97,"ratings":{"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":50,"pass_interceptions":19,"quickness":63}},{"id":679,"team_id":22,"name":"Al Noga","position":"DL","position_detail":"LE","jersey":153,"face":49,"name_rom_offset":9893,"ability_rom_offset":14951,"team_idx":22,"pos_idx":19,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":50,"pass_interceptions":31,"quickness":56,"jerseyNumber":99,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":50,"pass_interceptions":31,"quickness":56}},{"id":680,"team_id":22,"name":"M. Merriweather","position":"LB","position_detail":"ROLB","jersey":87,"face":171,"name_rom_offset":9900,"ability_rom_offset":14955,"team_idx":22,"pos_idx":20,"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":56,"pass_interceptions":44,"quickness":69,"jerseyNumber":57,"ratings":{"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":56,"pass_interceptions":44,"quickness":69}},{"id":681,"team_id":22,"name":"Keith Millard","position":"LB","position_detail":"RILB","jersey":117,"face":30,"name_rom_offset":9915,"ability_rom_offset":14959,"team_idx":22,"pos_idx":21,"rushing_power":50,"running_speed":38,"maximum_speed":56,"hitting_power":69,"pass_interceptions":19,"quickness":81,"jerseyNumber":75,"ratings":{"rushing_power":50,"running_speed":38,"maximum_speed":56,"hitting_power":69,"pass_interceptions":19,"quickness":81}},{"id":682,"team_id":22,"name":"Scott Studwell","position":"LB","position_detail":"LILB","jersey":85,"face":41,"name_rom_offset":9928,"ability_rom_offset":14963,"team_idx":22,"pos_idx":22,"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":31,"pass_interceptions":19,"quickness":31,"jerseyNumber":55,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":31,"pass_interceptions":19,"quickness":31}},{"id":683,"team_id":22,"name":"Ray Berry","position":"LB","position_detail":"LOLB","jersey":80,"face":47,"name_rom_offset":9942,"ability_rom_offset":14967,"team_idx":22,"pos_idx":23,"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":31,"pass_interceptions":19,"quickness":31,"jerseyNumber":50,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":31,"pass_interceptions":19,"quickness":31}},{"id":684,"team_id":22,"name":"Reggie Rutland","position":"DB","position_detail":"RCB","jersey":72,"face":203,"name_rom_offset":9951,"ability_rom_offset":14971,"team_idx":22,"pos_idx":24,"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":38,"pass_interceptions":44,"quickness":50,"jerseyNumber":48,"ratings":{"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":38,"pass_interceptions":44,"quickness":50}},{"id":685,"team_id":22,"name":"Carl Lee","position":"DB","position_detail":"LCB","jersey":57,"face":136,"name_rom_offset":9965,"ability_rom_offset":14975,"team_idx":22,"pos_idx":25,"rushing_power":50,"running_speed":38,"maximum_speed":63,"hitting_power":56,"pass_interceptions":50,"quickness":69,"jerseyNumber":39,"ratings":{"rushing_power":50,"running_speed":38,"maximum_speed":63,"hitting_power":56,"pass_interceptions":50,"quickness":69}},{"id":686,"team_id":22,"name":"D. Fullington","position":"DB","position_detail":"FS","jersey":41,"face":176,"name_rom_offset":9973,"ability_rom_offset":14979,"team_idx":22,"pos_idx":26,"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":44,"pass_interceptions":38,"quickness":44,"jerseyNumber":29,"ratings":{"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":44,"pass_interceptions":38,"quickness":44}},{"id":687,"team_id":22,"name":"Joey Browner","position":"DB","position_detail":"SS","jersey":71,"face":170,"name_rom_offset":9986,"ability_rom_offset":14983,"team_idx":22,"pos_idx":27,"rushing_power":50,"running_speed":38,"maximum_speed":63,"hitting_power":56,"pass_interceptions":69,"quickness":69,"jerseyNumber":47,"ratings":{"rushing_power":50,"running_speed":38,"maximum_speed":63,"hitting_power":56,"pass_interceptions":69,"quickness":69}},{"id":688,"team_id":22,"name":"Fuad Reveiz","position":"K","position_detail":"K","jersey":7,"face":19,"name_rom_offset":9998,"ability_rom_offset":14987,"team_idx":22,"pos_idx":28,"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":44,"avoid_kick_block":63,"jerseyNumber":7,"ratings":{"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":44,"avoid_kick_block":63}},{"id":689,"team_id":22,"name":"Harry Newsome","position":"P","position_detail":"P","jersey":24,"face":32,"name_rom_offset":10009,"ability_rom_offset":14991,"team_idx":22,"pos_idx":29,"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":25,"avoid_kick_block":44,"jerseyNumber":18,"ratings":{"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":25,"avoid_kick_block":44}},{"id":690,"team_id":23,"name":"Vinny Testaverde","position":"QB","position_detail":"QB1","jersey":20,"face":35,"name_rom_offset":10022,"ability_rom_offset":14995,"team_idx":23,"pos_idx":0,"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":13,"passing_speed":31,"pass_control":56,"accuracy_of_passing":44,"avoid_pass_block":44,"jerseyNumber":14,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":13,"passing_speed":31,"pass_control":56,"accuracy_of_passing":44,"avoid_pass_block":44}},{"id":691,"team_id":23,"name":"Jeff Carlson","position":"QB","position_detail":"QB2","jersey":7,"face":66,"name_rom_offset":10038,"ability_rom_offset":15000,"team_idx":23,"pos_idx":1,"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":44,"pass_control":38,"accuracy_of_passing":31,"avoid_pass_block":38,"jerseyNumber":7,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":44,"pass_control":38,"accuracy_of_passing":31,"avoid_pass_block":38}},{"id":692,"team_id":23,"name":"Gary Anderson","position":"RB","position_detail":"RB1","jersey":64,"face":204,"name_rom_offset":10050,"ability_rom_offset":15005,"team_idx":23,"pos_idx":2,"rushing_power":69,"running_speed":38,"maximum_speed":50,"hitting_power":25,"ball_control":50,"receptions":50,"jerseyNumber":40,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":50,"hitting_power":25,"ball_control":50,"receptions":50}},{"id":693,"team_id":23,"name":"Reggie Cobb","position":"RB","position_detail":"RB2","jersey":51,"face":199,"name_rom_offset":10063,"ability_rom_offset":15009,"team_idx":23,"pos_idx":3,"rushing_power":69,"running_speed":44,"maximum_speed":25,"hitting_power":94,"ball_control":50,"receptions":44,"jerseyNumber":33,"ratings":{"rushing_power":69,"running_speed":44,"maximum_speed":25,"hitting_power":94,"ball_control":50,"receptions":44}},{"id":694,"team_id":23,"name":"Bruce Perkins","position":"RB","position_detail":"RB3","jersey":50,"face":128,"name_rom_offset":10074,"ability_rom_offset":15013,"team_idx":23,"pos_idx":4,"rushing_power":69,"running_speed":38,"maximum_speed":31,"hitting_power":31,"ball_control":50,"receptions":25,"jerseyNumber":32,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":31,"hitting_power":31,"ball_control":50,"receptions":25}},{"id":695,"team_id":23,"name":"John Harvey","position":"RB","position_detail":"RB4","jersey":38,"face":151,"name_rom_offset":10087,"ability_rom_offset":15017,"team_idx":23,"pos_idx":5,"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":25,"ball_control":50,"receptions":25,"jerseyNumber":26,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":25,"ball_control":50,"receptions":25}},{"id":696,"team_id":23,"name":"Mark Carrier","position":"WR","position_detail":"WR1","jersey":136,"face":176,"name_rom_offset":10098,"ability_rom_offset":15021,"team_idx":23,"pos_idx":6,"rushing_power":69,"running_speed":38,"maximum_speed":44,"hitting_power":13,"ball_control":50,"receptions":63,"jerseyNumber":88,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":44,"hitting_power":13,"ball_control":50,"receptions":63}},{"id":697,"team_id":23,"name":"Bruce Hill","position":"WR","position_detail":"WR2","jersey":132,"face":156,"name_rom_offset":10110,"ability_rom_offset":15025,"team_idx":23,"pos_idx":7,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":50,"jerseyNumber":84,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":50}},{"id":698,"team_id":23,"name":"Danny Peebles","position":"WR","position_detail":"WR3","jersey":131,"face":133,"name_rom_offset":10120,"ability_rom_offset":15029,"team_idx":23,"pos_idx":8,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":13,"ball_control":50,"receptions":44,"jerseyNumber":83,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":13,"ball_control":50,"receptions":44}},{"id":699,"team_id":23,"name":"Willie Drewrey","position":"WR","position_detail":"WR4","jersey":135,"face":184,"name_rom_offset":10133,"ability_rom_offset":15033,"team_idx":23,"pos_idx":9,"rushing_power":69,"running_speed":31,"maximum_speed":31,"hitting_power":13,"ball_control":50,"receptions":44,"jerseyNumber":87,"ratings":{"rushing_power":69,"running_speed":31,"maximum_speed":31,"hitting_power":13,"ball_control":50,"receptions":44}},{"id":700,"team_id":23,"name":"Ron Hall","position":"TE","position_detail":"TE1","jersey":130,"face":50,"name_rom_offset":10147,"ability_rom_offset":15037,"team_idx":23,"pos_idx":10,"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":44,"ball_control":50,"receptions":44,"jerseyNumber":82,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":44,"ball_control":50,"receptions":44}},{"id":701,"team_id":23,"name":"Jesse Anderson","position":"TE","position_detail":"TE2","jersey":137,"face":192,"name_rom_offset":10155,"ability_rom_offset":15041,"team_idx":23,"pos_idx":11,"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":44,"ball_control":50,"receptions":31,"jerseyNumber":89,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":44,"ball_control":50,"receptions":31}},{"id":702,"team_id":23,"name":"Randy Grimes","position":"OL","position_detail":"C","jersey":96,"face":72,"name_rom_offset":10169,"ability_rom_offset":15045,"team_idx":23,"pos_idx":12,"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":31,"jerseyNumber":60,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":31}},{"id":703,"team_id":23,"name":"Carl Bax","position":"OL","position_detail":"LG","jersey":117,"face":12,"name_rom_offset":10181,"ability_rom_offset":15048,"team_idx":23,"pos_idx":13,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":38,"jerseyNumber":75,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":38}},{"id":704,"team_id":23,"name":"Ian Beckles","position":"OL","position_detail":"RG","jersey":98,"face":175,"name_rom_offset":10189,"ability_rom_offset":15051,"team_idx":23,"pos_idx":14,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":44,"jerseyNumber":62,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":44}},{"id":705,"team_id":23,"name":"Paul Gruber","position":"OL","position_detail":"LT","jersey":116,"face":28,"name_rom_offset":10200,"ability_rom_offset":15054,"team_idx":23,"pos_idx":15,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":50,"jerseyNumber":74,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":50}},{"id":706,"team_id":23,"name":"Rob Taylor","position":"OL","position_detail":"RT","jersey":114,"face":69,"name_rom_offset":10211,"ability_rom_offset":15057,"team_idx":23,"pos_idx":16,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":38,"jerseyNumber":72,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":38}},{"id":707,"team_id":23,"name":"Jim Skow","position":"DL","position_detail":"RE","jersey":113,"face":67,"name_rom_offset":10221,"ability_rom_offset":15060,"team_idx":23,"pos_idx":17,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":31,"pass_interceptions":19,"quickness":44,"jerseyNumber":71,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":31,"pass_interceptions":19,"quickness":44}},{"id":708,"team_id":23,"name":"Tim Newton","position":"DL","position_detail":"NT","jersey":150,"face":200,"name_rom_offset":10229,"ability_rom_offset":15064,"team_idx":23,"pos_idx":18,"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":50,"pass_interceptions":19,"quickness":44,"jerseyNumber":96,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":50,"pass_interceptions":19,"quickness":44}},{"id":709,"team_id":23,"name":"Rueben Davis","position":"DL","position_detail":"LE","jersey":121,"face":193,"name_rom_offset":10239,"ability_rom_offset":15068,"team_idx":23,"pos_idx":19,"rushing_power":38,"running_speed":25,"maximum_speed":31,"hitting_power":50,"pass_interceptions":19,"quickness":38,"jerseyNumber":79,"ratings":{"rushing_power":38,"running_speed":25,"maximum_speed":31,"hitting_power":50,"pass_interceptions":19,"quickness":38}},{"id":710,"team_id":23,"name":"Kevin Murphy","position":"LB","position_detail":"ROLB","jersey":89,"face":142,"name_rom_offset":10251,"ability_rom_offset":15072,"team_idx":23,"pos_idx":20,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":31,"pass_interceptions":19,"quickness":25,"jerseyNumber":59,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":31,"pass_interceptions":19,"quickness":25}},{"id":711,"team_id":23,"name":"Winston Moss","position":"LB","position_detail":"RILB","jersey":88,"face":205,"name_rom_offset":10263,"ability_rom_offset":15076,"team_idx":23,"pos_idx":21,"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":31,"pass_interceptions":31,"quickness":38,"jerseyNumber":58,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":31,"pass_interceptions":31,"quickness":38}},{"id":712,"team_id":23,"name":"Eugene Marve","position":"LB","position_detail":"LILB","jersey":153,"face":192,"name_rom_offset":10275,"ability_rom_offset":15080,"team_idx":23,"pos_idx":22,"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":31,"pass_interceptions":19,"quickness":25,"jerseyNumber":99,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":31,"pass_interceptions":19,"quickness":25}},{"id":713,"team_id":23,"name":"Broderick Thomas","position":"LB","position_detail":"LOLB","jersey":81,"face":180,"name_rom_offset":10287,"ability_rom_offset":15084,"team_idx":23,"pos_idx":23,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":19,"quickness":56,"jerseyNumber":51,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":19,"quickness":56}},{"id":714,"team_id":23,"name":"Wayne Haddix","position":"DB","position_detail":"RCB","jersey":69,"face":201,"name_rom_offset":10303,"ability_rom_offset":15088,"team_idx":23,"pos_idx":24,"rushing_power":56,"running_speed":44,"maximum_speed":75,"hitting_power":44,"pass_interceptions":75,"quickness":69,"jerseyNumber":45,"ratings":{"rushing_power":56,"running_speed":44,"maximum_speed":75,"hitting_power":44,"pass_interceptions":75,"quickness":69}},{"id":715,"team_id":23,"name":"Ricky Reynolds","position":"DB","position_detail":"LCB","jersey":41,"face":196,"name_rom_offset":10315,"ability_rom_offset":15092,"team_idx":23,"pos_idx":25,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":31,"pass_interceptions":50,"quickness":38,"jerseyNumber":29,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":31,"pass_interceptions":50,"quickness":38}},{"id":716,"team_id":23,"name":"Harry Hamilton","position":"DB","position_detail":"FS","jersey":57,"face":137,"name_rom_offset":10329,"ability_rom_offset":15096,"team_idx":23,"pos_idx":26,"rushing_power":31,"running_speed":25,"maximum_speed":44,"hitting_power":44,"pass_interceptions":56,"quickness":50,"jerseyNumber":39,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":44,"hitting_power":44,"pass_interceptions":56,"quickness":50}},{"id":717,"team_id":23,"name":"Mark Robinson","position":"DB","position_detail":"SS","jersey":48,"face":170,"name_rom_offset":10343,"ability_rom_offset":15100,"team_idx":23,"pos_idx":27,"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":50,"pass_interceptions":56,"quickness":44,"jerseyNumber":30,"ratings":{"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":50,"pass_interceptions":56,"quickness":44}},{"id":718,"team_id":23,"name":"Steve Christie","position":"K","position_detail":"K","jersey":2,"face":17,"name_rom_offset":10356,"ability_rom_offset":15104,"team_idx":23,"pos_idx":28,"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":69,"avoid_kick_block":75,"jerseyNumber":2,"ratings":{"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":69,"avoid_kick_block":75}},{"id":719,"team_id":23,"name":"Mark Royals","position":"P","position_detail":"P","jersey":3,"face":74,"name_rom_offset":10370,"ability_rom_offset":15108,"team_idx":23,"pos_idx":29,"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":38,"avoid_kick_block":69,"jerseyNumber":3,"ratings":{"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":38,"avoid_kick_block":69}},{"id":720,"team_id":24,"name":"Joe Montana","position":"QB","position_detail":"QB1","jersey":22,"face":1,"name_rom_offset":10381,"ability_rom_offset":15112,"team_idx":24,"pos_idx":0,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":13,"passing_speed":56,"pass_control":81,"accuracy_of_passing":81,"avoid_pass_block":75,"jerseyNumber":16,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":13,"passing_speed":56,"pass_control":81,"accuracy_of_passing":81,"avoid_pass_block":75}},{"id":721,"team_id":24,"name":"Steve Young","position":"QB","position_detail":"QB2","jersey":8,"face":51,"name_rom_offset":10392,"ability_rom_offset":15117,"team_idx":24,"pos_idx":1,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"passing_speed":56,"pass_control":44,"accuracy_of_passing":50,"avoid_pass_block":56,"jerseyNumber":8,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"passing_speed":56,"pass_control":44,"accuracy_of_passing":50,"avoid_pass_block":56}},{"id":722,"team_id":24,"name":"Roger Craig","position":"RB","position_detail":"RB1","jersey":51,"face":208,"name_rom_offset":10403,"ability_rom_offset":15122,"team_idx":24,"pos_idx":2,"rushing_power":69,"running_speed":38,"maximum_speed":50,"hitting_power":25,"ball_control":50,"receptions":44,"jerseyNumber":33,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":50,"hitting_power":25,"ball_control":50,"receptions":44}},{"id":723,"team_id":24,"name":"Tom Rathman","position":"RB","position_detail":"RB2","jersey":68,"face":50,"name_rom_offset":10414,"ability_rom_offset":15126,"team_idx":24,"pos_idx":3,"rushing_power":69,"running_speed":44,"maximum_speed":25,"hitting_power":94,"ball_control":50,"receptions":56,"jerseyNumber":44,"ratings":{"rushing_power":69,"running_speed":44,"maximum_speed":25,"hitting_power":94,"ball_control":50,"receptions":56}},{"id":724,"team_id":24,"name":"Dexter Carter","position":"RB","position_detail":"RB3","jersey":53,"face":151,"name_rom_offset":10425,"ability_rom_offset":15130,"team_idx":24,"pos_idx":4,"rushing_power":69,"running_speed":38,"maximum_speed":44,"hitting_power":19,"ball_control":50,"receptions":38,"jerseyNumber":35,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":44,"hitting_power":19,"ball_control":50,"receptions":38}},{"id":725,"team_id":24,"name":"Harry Sydney","position":"RB","position_detail":"RB4","jersey":36,"face":160,"name_rom_offset":10438,"ability_rom_offset":15134,"team_idx":24,"pos_idx":5,"rushing_power":69,"running_speed":38,"maximum_speed":44,"hitting_power":25,"ball_control":50,"receptions":31,"jerseyNumber":24,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":44,"hitting_power":25,"ball_control":50,"receptions":31}},{"id":726,"team_id":24,"name":"John Taylor","position":"WR","position_detail":"WR1","jersey":130,"face":201,"name_rom_offset":10450,"ability_rom_offset":15138,"team_idx":24,"pos_idx":6,"rushing_power":69,"running_speed":38,"maximum_speed":50,"hitting_power":13,"ball_control":63,"receptions":69,"jerseyNumber":82,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":50,"hitting_power":13,"ball_control":63,"receptions":69}},{"id":727,"team_id":24,"name":"Jerry Rice","position":"WR","position_detail":"WR2","jersey":128,"face":163,"name_rom_offset":10461,"ability_rom_offset":15142,"team_idx":24,"pos_idx":7,"rushing_power":69,"running_speed":44,"maximum_speed":69,"hitting_power":13,"ball_control":81,"receptions":81,"jerseyNumber":80,"ratings":{"rushing_power":69,"running_speed":44,"maximum_speed":69,"hitting_power":13,"ball_control":81,"receptions":81}},{"id":728,"team_id":24,"name":"Mike Wilson","position":"WR","position_detail":"WR3","jersey":133,"face":192,"name_rom_offset":10471,"ability_rom_offset":15146,"team_idx":24,"pos_idx":8,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":44,"jerseyNumber":85,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":44}},{"id":729,"team_id":24,"name":"Mike Sherrard","position":"WR","position_detail":"WR4","jersey":136,"face":133,"name_rom_offset":10482,"ability_rom_offset":15150,"team_idx":24,"pos_idx":9,"rushing_power":69,"running_speed":38,"maximum_speed":44,"hitting_power":13,"ball_control":50,"receptions":50,"jerseyNumber":88,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":44,"hitting_power":13,"ball_control":50,"receptions":50}},{"id":730,"team_id":24,"name":"Brent Jones","position":"TE","position_detail":"TE1","jersey":132,"face":67,"name_rom_offset":10495,"ability_rom_offset":15154,"team_idx":24,"pos_idx":10,"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":69,"ball_control":50,"receptions":69,"jerseyNumber":84,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":69,"ball_control":50,"receptions":69}},{"id":731,"team_id":24,"name":"Jamie Williams","position":"TE","position_detail":"TE2","jersey":129,"face":190,"name_rom_offset":10506,"ability_rom_offset":15158,"team_idx":24,"pos_idx":11,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":38,"ball_control":50,"receptions":31,"jerseyNumber":81,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":38,"ball_control":50,"receptions":31}},{"id":732,"team_id":24,"name":"Jesse Sapolu","position":"OL","position_detail":"C","jersey":97,"face":130,"name_rom_offset":10520,"ability_rom_offset":15162,"team_idx":24,"pos_idx":12,"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":63,"jerseyNumber":61,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":63}},{"id":733,"team_id":24,"name":"Guy Mcintyre","position":"OL","position_detail":"LG","jersey":98,"face":172,"name_rom_offset":10532,"ability_rom_offset":15165,"team_idx":24,"pos_idx":13,"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":50,"jerseyNumber":62,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":50}},{"id":734,"team_id":24,"name":"Harris Barton","position":"OL","position_detail":"RG","jersey":121,"face":31,"name_rom_offset":10544,"ability_rom_offset":15168,"team_idx":24,"pos_idx":14,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":56,"jerseyNumber":79,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":56}},{"id":735,"team_id":24,"name":"Bubba Paris","position":"OL","position_detail":"LT","jersey":119,"face":174,"name_rom_offset":10557,"ability_rom_offset":15171,"team_idx":24,"pos_idx":15,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":69,"jerseyNumber":77,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":69}},{"id":736,"team_id":24,"name":"Steve Wallace","position":"OL","position_detail":"RT","jersey":116,"face":175,"name_rom_offset":10568,"ability_rom_offset":15174,"team_idx":24,"pos_idx":16,"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":63,"jerseyNumber":74,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":63}},{"id":737,"team_id":24,"name":"Kevin Fagan","position":"DL","position_detail":"RE","jersey":117,"face":56,"name_rom_offset":10581,"ability_rom_offset":15177,"team_idx":24,"pos_idx":17,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":50,"pass_interceptions":19,"quickness":44,"jerseyNumber":75,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":50,"pass_interceptions":19,"quickness":44}},{"id":738,"team_id":24,"name":"Michael Carter","position":"DL","position_detail":"NT","jersey":149,"face":156,"name_rom_offset":10592,"ability_rom_offset":15181,"team_idx":24,"pos_idx":18,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":69,"pass_interceptions":19,"quickness":56,"jerseyNumber":95,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":69,"pass_interceptions":19,"quickness":56}},{"id":739,"team_id":24,"name":"Pierce Holt","position":"DL","position_detail":"LE","jersey":120,"face":42,"name_rom_offset":10606,"ability_rom_offset":15185,"team_idx":24,"pos_idx":19,"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":69,"pass_interceptions":19,"quickness":50,"jerseyNumber":78,"ratings":{"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":69,"pass_interceptions":19,"quickness":50}},{"id":740,"team_id":24,"name":"Bill Romanowski","position":"LB","position_detail":"ROLB","jersey":83,"face":79,"name_rom_offset":10617,"ability_rom_offset":15189,"team_idx":24,"pos_idx":20,"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":50,"pass_interceptions":19,"quickness":63,"jerseyNumber":53,"ratings":{"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":50,"pass_interceptions":19,"quickness":63}},{"id":741,"team_id":24,"name":"Keith Delong","position":"LB","position_detail":"RILB","jersey":89,"face":12,"name_rom_offset":10632,"ability_rom_offset":15193,"team_idx":24,"pos_idx":21,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":44,"pass_interceptions":19,"quickness":44,"jerseyNumber":59,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":44,"pass_interceptions":19,"quickness":44}},{"id":742,"team_id":24,"name":"Matt Millen","position":"LB","position_detail":"LILB","jersey":84,"face":28,"name_rom_offset":10644,"ability_rom_offset":15197,"team_idx":24,"pos_idx":22,"rushing_power":38,"running_speed":25,"maximum_speed":50,"hitting_power":63,"pass_interceptions":31,"quickness":63,"jerseyNumber":54,"ratings":{"rushing_power":38,"running_speed":25,"maximum_speed":50,"hitting_power":63,"pass_interceptions":31,"quickness":63}},{"id":743,"team_id":24,"name":"Charles Haley","position":"LB","position_detail":"LOLB","jersey":148,"face":183,"name_rom_offset":10655,"ability_rom_offset":15201,"team_idx":24,"pos_idx":23,"rushing_power":50,"running_speed":38,"maximum_speed":56,"hitting_power":63,"pass_interceptions":19,"quickness":75,"jerseyNumber":94,"ratings":{"rushing_power":50,"running_speed":38,"maximum_speed":56,"hitting_power":63,"pass_interceptions":19,"quickness":75}},{"id":744,"team_id":24,"name":"Don Griffin","position":"DB","position_detail":"RCB","jersey":41,"face":138,"name_rom_offset":10668,"ability_rom_offset":15205,"team_idx":24,"pos_idx":24,"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":38,"pass_interceptions":50,"quickness":50,"jerseyNumber":29,"ratings":{"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":38,"pass_interceptions":50,"quickness":50}},{"id":745,"team_id":24,"name":"Darryl Pollard","position":"DB","position_detail":"LCB","jersey":38,"face":142,"name_rom_offset":10679,"ability_rom_offset":15209,"team_idx":24,"pos_idx":25,"rushing_power":31,"running_speed":25,"maximum_speed":44,"hitting_power":44,"pass_interceptions":38,"quickness":44,"jerseyNumber":26,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":44,"hitting_power":44,"pass_interceptions":38,"quickness":44}},{"id":746,"team_id":24,"name":"Ronnie Lott","position":"DB","position_detail":"FS","jersey":66,"face":171,"name_rom_offset":10693,"ability_rom_offset":15213,"team_idx":24,"pos_idx":26,"rushing_power":56,"running_speed":44,"maximum_speed":69,"hitting_power":69,"pass_interceptions":50,"quickness":75,"jerseyNumber":42,"ratings":{"rushing_power":56,"running_speed":44,"maximum_speed":69,"hitting_power":69,"pass_interceptions":50,"quickness":75}},{"id":747,"team_id":24,"name":"Dave Waymer","position":"DB","position_detail":"SS","jersey":67,"face":209,"name_rom_offset":10704,"ability_rom_offset":15217,"team_idx":24,"pos_idx":27,"rushing_power":50,"running_speed":38,"maximum_speed":63,"hitting_power":50,"pass_interceptions":69,"quickness":63,"jerseyNumber":43,"ratings":{"rushing_power":50,"running_speed":38,"maximum_speed":63,"hitting_power":50,"pass_interceptions":69,"quickness":63}},{"id":748,"team_id":24,"name":"Mike Cofer","position":"K","position_detail":"K","jersey":6,"face":33,"name_rom_offset":10715,"ability_rom_offset":15221,"team_idx":24,"pos_idx":28,"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":56,"avoid_kick_block":56,"jerseyNumber":6,"ratings":{"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":56,"avoid_kick_block":56}},{"id":749,"team_id":24,"name":"Barry Helton","position":"P","position_detail":"P","jersey":9,"face":12,"name_rom_offset":10725,"ability_rom_offset":15225,"team_idx":24,"pos_idx":29,"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":19,"avoid_kick_block":38,"jerseyNumber":9,"ratings":{"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":19,"avoid_kick_block":38}},{"id":750,"team_id":25,"name":"Jim Everett","position":"QB","position_detail":"QB1","jersey":17,"face":37,"name_rom_offset":10737,"ability_rom_offset":15229,"team_idx":25,"pos_idx":0,"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":56,"pass_control":63,"accuracy_of_passing":50,"avoid_pass_block":44,"jerseyNumber":11,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":56,"pass_control":63,"accuracy_of_passing":50,"avoid_pass_block":44}},{"id":751,"team_id":25,"name":"Chuck Long","position":"QB","position_detail":"QB2","jersey":22,"face":21,"name_rom_offset":10748,"ability_rom_offset":15234,"team_idx":25,"pos_idx":1,"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":44,"pass_control":38,"accuracy_of_passing":31,"avoid_pass_block":38,"jerseyNumber":16,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":44,"pass_control":38,"accuracy_of_passing":31,"avoid_pass_block":38}},{"id":752,"team_id":25,"name":"Cleveland Gary","position":"RB","position_detail":"RB1","jersey":67,"face":148,"name_rom_offset":10758,"ability_rom_offset":15239,"team_idx":25,"pos_idx":2,"rushing_power":69,"running_speed":38,"maximum_speed":50,"hitting_power":38,"ball_control":38,"receptions":38,"jerseyNumber":43,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":50,"hitting_power":38,"ball_control":38,"receptions":38}},{"id":753,"team_id":25,"name":"Curt Warner","position":"RB","position_detail":"RB2","jersey":33,"face":131,"name_rom_offset":10772,"ability_rom_offset":15243,"team_idx":25,"pos_idx":3,"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":31,"ball_control":50,"receptions":25,"jerseyNumber":21,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":31,"ball_control":50,"receptions":25}},{"id":754,"team_id":25,"name":"Gaston Green","position":"RB","position_detail":"RB3","jersey":68,"face":129,"name_rom_offset":10783,"ability_rom_offset":15247,"team_idx":25,"pos_idx":4,"rushing_power":69,"running_speed":38,"maximum_speed":44,"hitting_power":25,"ball_control":50,"receptions":25,"jerseyNumber":44,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":44,"hitting_power":25,"ball_control":50,"receptions":25}},{"id":755,"team_id":25,"name":"Buford Mcgee","position":"RB","position_detail":"RB4","jersey":36,"face":141,"name_rom_offset":10795,"ability_rom_offset":15251,"team_idx":25,"pos_idx":5,"rushing_power":69,"running_speed":38,"maximum_speed":44,"hitting_power":31,"ball_control":50,"receptions":50,"jerseyNumber":24,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":44,"hitting_power":31,"ball_control":50,"receptions":50}},{"id":756,"team_id":25,"name":"Henry Ellard","position":"WR","position_detail":"WR1","jersey":128,"face":189,"name_rom_offset":10807,"ability_rom_offset":15255,"team_idx":25,"pos_idx":6,"rushing_power":69,"running_speed":44,"maximum_speed":56,"hitting_power":13,"ball_control":50,"receptions":81,"jerseyNumber":80,"ratings":{"rushing_power":69,"running_speed":44,"maximum_speed":56,"hitting_power":13,"ball_control":50,"receptions":81}},{"id":757,"team_id":25,"name":"Willie Anderson","position":"WR","position_detail":"WR2","jersey":131,"face":139,"name_rom_offset":10819,"ability_rom_offset":15259,"team_idx":25,"pos_idx":7,"rushing_power":69,"running_speed":44,"maximum_speed":56,"hitting_power":13,"ball_control":50,"receptions":75,"jerseyNumber":83,"ratings":{"rushing_power":69,"running_speed":44,"maximum_speed":56,"hitting_power":13,"ball_control":50,"receptions":75}},{"id":758,"team_id":25,"name":"Derrick Faison","position":"WR","position_detail":"WR3","jersey":137,"face":184,"name_rom_offset":10834,"ability_rom_offset":15263,"team_idx":25,"pos_idx":8,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":44,"jerseyNumber":89,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":44}},{"id":759,"team_id":25,"name":"Aaron Cox","position":"WR","position_detail":"WR4","jersey":132,"face":142,"name_rom_offset":10848,"ability_rom_offset":15267,"team_idx":25,"pos_idx":9,"rushing_power":69,"running_speed":31,"maximum_speed":31,"hitting_power":13,"ball_control":50,"receptions":44,"jerseyNumber":84,"ratings":{"rushing_power":69,"running_speed":31,"maximum_speed":31,"hitting_power":13,"ball_control":50,"receptions":44}},{"id":760,"team_id":25,"name":"Pete Holohan","position":"TE","position_detail":"TE1","jersey":129,"face":67,"name_rom_offset":10857,"ability_rom_offset":15271,"team_idx":25,"pos_idx":10,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":56,"ball_control":50,"receptions":56,"jerseyNumber":81,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":56,"ball_control":50,"receptions":56}},{"id":761,"team_id":25,"name":"Damone Johnson","position":"TE","position_detail":"TE2","jersey":134,"face":176,"name_rom_offset":10869,"ability_rom_offset":15275,"team_idx":25,"pos_idx":11,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":44,"ball_control":50,"receptions":31,"jerseyNumber":86,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":44,"ball_control":50,"receptions":31}},{"id":762,"team_id":25,"name":"Doug Smith","position":"OL","position_detail":"C","jersey":86,"face":12,"name_rom_offset":10883,"ability_rom_offset":15279,"team_idx":25,"pos_idx":12,"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":63,"jerseyNumber":56,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":38,"hitting_power":63}},{"id":763,"team_id":25,"name":"Tom Newberry","position":"OL","position_detail":"LG","jersey":102,"face":49,"name_rom_offset":10893,"ability_rom_offset":15282,"team_idx":25,"pos_idx":13,"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":50,"jerseyNumber":66,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":50}},{"id":764,"team_id":25,"name":"Bern Brostek","position":"OL","position_detail":"RG","jersey":97,"face":31,"name_rom_offset":10905,"ability_rom_offset":15285,"team_idx":25,"pos_idx":14,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":56,"jerseyNumber":61,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":56}},{"id":765,"team_id":25,"name":"Irv Pankey","position":"OL","position_detail":"LT","jersey":117,"face":166,"name_rom_offset":10917,"ability_rom_offset":15288,"team_idx":25,"pos_idx":15,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":63,"jerseyNumber":75,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":63}},{"id":766,"team_id":25,"name":"Jackie Slater","position":"OL","position_detail":"RT","jersey":120,"face":193,"name_rom_offset":10927,"ability_rom_offset":15291,"team_idx":25,"pos_idx":16,"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":63,"jerseyNumber":78,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":63}},{"id":767,"team_id":25,"name":"Brian Smith","position":"DL","position_detail":"RE","jersey":150,"face":192,"name_rom_offset":10940,"ability_rom_offset":15294,"team_idx":25,"pos_idx":17,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":19,"quickness":31,"jerseyNumber":96,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":19,"quickness":31}},{"id":768,"team_id":25,"name":"Alvin Wright","position":"DL","position_detail":"NT","jersey":153,"face":143,"name_rom_offset":10951,"ability_rom_offset":15298,"team_idx":25,"pos_idx":18,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":50,"pass_interceptions":19,"quickness":31,"jerseyNumber":99,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":50,"pass_interceptions":19,"quickness":31}},{"id":769,"team_id":25,"name":"Doug Reed","position":"DL","position_detail":"LE","jersey":147,"face":136,"name_rom_offset":10963,"ability_rom_offset":15302,"team_idx":25,"pos_idx":19,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":44,"pass_interceptions":19,"quickness":44,"jerseyNumber":93,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":44,"pass_interceptions":19,"quickness":44}},{"id":770,"team_id":25,"name":"Mike Wilcher","position":"LB","position_detail":"ROLB","jersey":84,"face":156,"name_rom_offset":10972,"ability_rom_offset":15306,"team_idx":25,"pos_idx":20,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":19,"quickness":31,"jerseyNumber":54,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":19,"quickness":31}},{"id":771,"team_id":25,"name":"Fred Strickland","position":"LB","position_detail":"RILB","jersey":83,"face":178,"name_rom_offset":10984,"ability_rom_offset":15310,"team_idx":25,"pos_idx":21,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":19,"quickness":25,"jerseyNumber":53,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":19,"quickness":25}},{"id":772,"team_id":25,"name":"Frank Stams","position":"LB","position_detail":"LILB","jersey":80,"face":30,"name_rom_offset":10999,"ability_rom_offset":15314,"team_idx":25,"pos_idx":22,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":31,"pass_interceptions":19,"quickness":25,"jerseyNumber":50,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":31,"pass_interceptions":19,"quickness":25}},{"id":773,"team_id":25,"name":"Kevin Greene","position":"LB","position_detail":"LOLB","jersey":145,"face":67,"name_rom_offset":11010,"ability_rom_offset":15318,"team_idx":25,"pos_idx":23,"rushing_power":50,"running_speed":38,"maximum_speed":56,"hitting_power":69,"pass_interceptions":19,"quickness":69,"jerseyNumber":91,"ratings":{"rushing_power":50,"running_speed":38,"maximum_speed":56,"hitting_power":69,"pass_interceptions":19,"quickness":69}},{"id":774,"team_id":25,"name":"Bobby Humphery","position":"DB","position_detail":"RCB","jersey":72,"face":196,"name_rom_offset":11022,"ability_rom_offset":15322,"team_idx":25,"pos_idx":24,"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":31,"pass_interceptions":56,"quickness":31,"jerseyNumber":48,"ratings":{"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":31,"pass_interceptions":56,"quickness":31}},{"id":775,"team_id":25,"name":"Jerry Gray","position":"DB","position_detail":"LCB","jersey":37,"face":161,"name_rom_offset":11036,"ability_rom_offset":15326,"team_idx":25,"pos_idx":25,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":31,"pass_interceptions":38,"quickness":38,"jerseyNumber":25,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":31,"pass_interceptions":38,"quickness":38}},{"id":776,"team_id":25,"name":"Anthony Newman","position":"DB","position_detail":"FS","jersey":38,"face":158,"name_rom_offset":11046,"ability_rom_offset":15330,"team_idx":25,"pos_idx":26,"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":44,"pass_interceptions":44,"quickness":31,"jerseyNumber":26,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":44,"pass_interceptions":44,"quickness":31}},{"id":777,"team_id":25,"name":"Vince Newsome","position":"DB","position_detail":"SS","jersey":34,"face":150,"name_rom_offset":11060,"ability_rom_offset":15334,"team_idx":25,"pos_idx":27,"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":31,"pass_interceptions":56,"quickness":44,"jerseyNumber":22,"ratings":{"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":31,"pass_interceptions":56,"quickness":44}},{"id":778,"team_id":25,"name":"Mike Lansford","position":"K","position_detail":"K","jersey":1,"face":71,"name_rom_offset":11073,"ability_rom_offset":15338,"team_idx":25,"pos_idx":28,"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":19,"avoid_kick_block":25,"jerseyNumber":1,"ratings":{"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":19,"avoid_kick_block":25}},{"id":779,"team_id":25,"name":"Keith English","position":"P","position_detail":"P","jersey":8,"face":76,"name_rom_offset":11086,"ability_rom_offset":15342,"team_idx":25,"pos_idx":29,"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":19,"avoid_kick_block":50,"jerseyNumber":8,"ratings":{"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":19,"avoid_kick_block":50}},{"id":780,"team_id":26,"name":"Steve Walsh","position":"QB","position_detail":"QB1","jersey":3,"face":38,"name_rom_offset":11099,"ability_rom_offset":15346,"team_idx":26,"pos_idx":0,"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":44,"pass_control":38,"accuracy_of_passing":50,"avoid_pass_block":50,"jerseyNumber":3,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":44,"pass_control":38,"accuracy_of_passing":50,"avoid_pass_block":50}},{"id":781,"team_id":26,"name":"John Fourcade","position":"QB","position_detail":"QB2","jersey":17,"face":40,"name_rom_offset":11110,"ability_rom_offset":15351,"team_idx":26,"pos_idx":1,"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":44,"pass_control":44,"accuracy_of_passing":31,"avoid_pass_block":38,"jerseyNumber":11,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":44,"pass_control":44,"accuracy_of_passing":31,"avoid_pass_block":38}},{"id":782,"team_id":26,"name":"Craig Heyward","position":"RB","position_detail":"RB1","jersey":52,"face":184,"name_rom_offset":11123,"ability_rom_offset":15356,"team_idx":26,"pos_idx":2,"rushing_power":69,"running_speed":44,"maximum_speed":25,"hitting_power":94,"ball_control":50,"receptions":31,"jerseyNumber":34,"ratings":{"rushing_power":69,"running_speed":44,"maximum_speed":25,"hitting_power":94,"ball_control":50,"receptions":31}},{"id":783,"team_id":26,"name":"Dalton Hilliard","position":"RB","position_detail":"RB2","jersey":33,"face":195,"name_rom_offset":11136,"ability_rom_offset":15360,"team_idx":26,"pos_idx":3,"rushing_power":69,"running_speed":38,"maximum_speed":50,"hitting_power":25,"ball_control":50,"receptions":25,"jerseyNumber":21,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":50,"hitting_power":25,"ball_control":50,"receptions":25}},{"id":784,"team_id":26,"name":"Rueben Mayes","position":"RB","position_detail":"RB3","jersey":54,"face":193,"name_rom_offset":11151,"ability_rom_offset":15364,"team_idx":26,"pos_idx":4,"rushing_power":69,"running_speed":38,"maximum_speed":44,"hitting_power":25,"ball_control":50,"receptions":31,"jerseyNumber":36,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":44,"hitting_power":25,"ball_control":50,"receptions":31}},{"id":785,"team_id":26,"name":"Gil Fenerty","position":"RB","position_detail":"RB4","jersey":34,"face":52,"name_rom_offset":11163,"ability_rom_offset":15368,"team_idx":26,"pos_idx":5,"rushing_power":69,"running_speed":38,"maximum_speed":44,"hitting_power":25,"ball_control":50,"receptions":31,"jerseyNumber":22,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":44,"hitting_power":25,"ball_control":50,"receptions":31}},{"id":786,"team_id":26,"name":"Eric Martin","position":"WR","position_detail":"WR1","jersey":132,"face":203,"name_rom_offset":11174,"ability_rom_offset":15372,"team_idx":26,"pos_idx":6,"rushing_power":69,"running_speed":31,"maximum_speed":38,"hitting_power":13,"ball_control":50,"receptions":69,"jerseyNumber":84,"ratings":{"rushing_power":69,"running_speed":31,"maximum_speed":38,"hitting_power":13,"ball_control":50,"receptions":69}},{"id":787,"team_id":26,"name":"Brent Perriman","position":"WR","position_detail":"WR2","jersey":128,"face":199,"name_rom_offset":11185,"ability_rom_offset":15376,"team_idx":26,"pos_idx":7,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":50,"jerseyNumber":80,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":50}},{"id":788,"team_id":26,"name":"Lonzell Hill","position":"WR","position_detail":"WR3","jersey":135,"face":183,"name_rom_offset":11199,"ability_rom_offset":15380,"team_idx":26,"pos_idx":8,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":13,"ball_control":50,"receptions":44,"jerseyNumber":87,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":13,"ball_control":50,"receptions":44}},{"id":789,"team_id":26,"name":"Floyd Turner","position":"WR","position_detail":"WR4","jersey":136,"face":154,"name_rom_offset":11211,"ability_rom_offset":15384,"team_idx":26,"pos_idx":9,"rushing_power":69,"running_speed":31,"maximum_speed":31,"hitting_power":13,"ball_control":50,"receptions":44,"jerseyNumber":88,"ratings":{"rushing_power":69,"running_speed":31,"maximum_speed":31,"hitting_power":13,"ball_control":50,"receptions":44}},{"id":790,"team_id":26,"name":"Hoby Brenner","position":"TE","position_detail":"TE1","jersey":133,"face":70,"name_rom_offset":11223,"ability_rom_offset":15388,"team_idx":26,"pos_idx":10,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":44,"ball_control":50,"receptions":38,"jerseyNumber":85,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":44,"ball_control":50,"receptions":38}},{"id":791,"team_id":26,"name":"John Tice","position":"TE","position_detail":"TE2","jersey":130,"face":19,"name_rom_offset":11235,"ability_rom_offset":15392,"team_idx":26,"pos_idx":11,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":38,"ball_control":50,"receptions":31,"jerseyNumber":82,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":38,"ball_control":50,"receptions":31}},{"id":792,"team_id":26,"name":"Joel Hilgenberg","position":"OL","position_detail":"C","jersey":97,"face":28,"name_rom_offset":11244,"ability_rom_offset":15396,"team_idx":26,"pos_idx":12,"rushing_power":69,"running_speed":25,"maximum_speed":44,"hitting_power":50,"jerseyNumber":61,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":44,"hitting_power":50}},{"id":793,"team_id":26,"name":"Jim Dombrowski","position":"OL","position_detail":"LG","jersey":114,"face":31,"name_rom_offset":11259,"ability_rom_offset":15399,"team_idx":26,"pos_idx":13,"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":69,"jerseyNumber":72,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":69}},{"id":794,"team_id":26,"name":"Steve Trapilo","position":"OL","position_detail":"RG","jersey":101,"face":47,"name_rom_offset":11273,"ability_rom_offset":15402,"team_idx":26,"pos_idx":14,"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":50,"jerseyNumber":65,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":50}},{"id":795,"team_id":26,"name":"Kevin Haverdink","position":"OL","position_detail":"LT","jersey":116,"face":78,"name_rom_offset":11286,"ability_rom_offset":15405,"team_idx":26,"pos_idx":15,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":56,"jerseyNumber":74,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":56}},{"id":796,"team_id":26,"name":"Stan Brock","position":"OL","position_detail":"RT","jersey":103,"face":57,"name_rom_offset":11301,"ability_rom_offset":15408,"team_idx":26,"pos_idx":16,"rushing_power":69,"running_speed":25,"maximum_speed":44,"hitting_power":69,"jerseyNumber":67,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":44,"hitting_power":69}},{"id":797,"team_id":26,"name":"Renaldo Turnbull","position":"DL","position_detail":"RE","jersey":151,"face":150,"name_rom_offset":11311,"ability_rom_offset":15411,"team_idx":26,"pos_idx":17,"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":63,"pass_interceptions":19,"quickness":63,"jerseyNumber":97,"ratings":{"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":63,"pass_interceptions":19,"quickness":63}},{"id":798,"team_id":26,"name":"Jim Wilks","position":"DL","position_detail":"NT","jersey":148,"face":172,"name_rom_offset":11327,"ability_rom_offset":15415,"team_idx":26,"pos_idx":18,"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":56,"pass_interceptions":19,"quickness":69,"jerseyNumber":94,"ratings":{"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":56,"pass_interceptions":19,"quickness":69}},{"id":799,"team_id":26,"name":"Wayne Martin","position":"DL","position_detail":"LE","jersey":147,"face":153,"name_rom_offset":11336,"ability_rom_offset":15419,"team_idx":26,"pos_idx":19,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":44,"pass_interceptions":19,"quickness":44,"jerseyNumber":93,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":44,"pass_interceptions":19,"quickness":44}},{"id":800,"team_id":26,"name":"Pat Swilling","position":"LB","position_detail":"ROLB","jersey":86,"face":170,"name_rom_offset":11348,"ability_rom_offset":15423,"team_idx":26,"pos_idx":20,"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":63,"pass_interceptions":19,"quickness":63,"jerseyNumber":56,"ratings":{"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":63,"pass_interceptions":19,"quickness":63}},{"id":801,"team_id":26,"name":"Vaughan Johnson","position":"LB","position_detail":"RILB","jersey":83,"face":200,"name_rom_offset":11360,"ability_rom_offset":15427,"team_idx":26,"pos_idx":21,"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":63,"pass_interceptions":19,"quickness":31,"jerseyNumber":53,"ratings":{"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":63,"pass_interceptions":19,"quickness":31}},{"id":802,"team_id":26,"name":"Sam Mills","position":"LB","position_detail":"LILB","jersey":81,"face":131,"name_rom_offset":11375,"ability_rom_offset":15431,"team_idx":26,"pos_idx":22,"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":50,"pass_interceptions":19,"quickness":31,"jerseyNumber":51,"ratings":{"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":50,"pass_interceptions":19,"quickness":31}},{"id":803,"team_id":26,"name":"Rickey Jackson","position":"LB","position_detail":"LOLB","jersey":87,"face":204,"name_rom_offset":11384,"ability_rom_offset":15435,"team_idx":26,"pos_idx":23,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":19,"quickness":56,"jerseyNumber":57,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":19,"quickness":56}},{"id":804,"team_id":26,"name":"Toi Cook","position":"DB","position_detail":"RCB","jersey":65,"face":171,"name_rom_offset":11398,"ability_rom_offset":15439,"team_idx":26,"pos_idx":24,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":44,"quickness":38,"jerseyNumber":41,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":44,"quickness":38}},{"id":805,"team_id":26,"name":"Robert Massey","position":"DB","position_detail":"LCB","jersey":64,"face":149,"name_rom_offset":11406,"ability_rom_offset":15443,"team_idx":26,"pos_idx":25,"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":44,"pass_interceptions":56,"quickness":50,"jerseyNumber":40,"ratings":{"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":44,"pass_interceptions":56,"quickness":50}},{"id":806,"team_id":26,"name":"Gene Atkins","position":"DB","position_detail":"FS","jersey":40,"face":141,"name_rom_offset":11419,"ability_rom_offset":15447,"team_idx":26,"pos_idx":26,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":44,"pass_interceptions":44,"quickness":50,"jerseyNumber":28,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":44,"pass_interceptions":44,"quickness":50}},{"id":807,"team_id":26,"name":"Brett Maxie","position":"DB","position_detail":"SS","jersey":57,"face":144,"name_rom_offset":11430,"ability_rom_offset":15451,"team_idx":26,"pos_idx":27,"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":44,"pass_interceptions":44,"quickness":38,"jerseyNumber":39,"ratings":{"rushing_power":38,"running_speed":31,"maximum_speed":50,"hitting_power":44,"pass_interceptions":44,"quickness":38}},{"id":808,"team_id":26,"name":"Morten Andersen","position":"K","position_detail":"K","jersey":7,"face":39,"name_rom_offset":11441,"ability_rom_offset":15455,"team_idx":26,"pos_idx":28,"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":56,"avoid_kick_block":69,"jerseyNumber":7,"ratings":{"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":56,"avoid_kick_block":69}},{"id":809,"team_id":26,"name":"Tommy Barnhardt","position":"P","position_detail":"P","jersey":6,"face":68,"name_rom_offset":11456,"ability_rom_offset":15459,"team_idx":26,"pos_idx":29,"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":63,"avoid_kick_block":44,"jerseyNumber":6,"ratings":{"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":63,"avoid_kick_block":44}},{"id":810,"team_id":27,"name":"Chris Miller","position":"QB","position_detail":"QB1","jersey":18,"face":51,"name_rom_offset":11471,"ability_rom_offset":15463,"team_idx":27,"pos_idx":0,"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":31,"pass_control":44,"accuracy_of_passing":50,"avoid_pass_block":31,"jerseyNumber":12,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":31,"pass_control":44,"accuracy_of_passing":50,"avoid_pass_block":31}},{"id":811,"team_id":27,"name":"Hugh Millen","position":"QB","position_detail":"QB2","jersey":7,"face":40,"name_rom_offset":11483,"ability_rom_offset":15468,"team_idx":27,"pos_idx":1,"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":38,"pass_control":38,"accuracy_of_passing":31,"avoid_pass_block":38,"jerseyNumber":7,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":13,"hitting_power":13,"passing_speed":38,"pass_control":38,"accuracy_of_passing":31,"avoid_pass_block":38}},{"id":812,"team_id":27,"name":"Mike Rozier","position":"RB","position_detail":"RB1","jersey":48,"face":199,"name_rom_offset":11494,"ability_rom_offset":15473,"team_idx":27,"pos_idx":2,"rushing_power":69,"running_speed":38,"maximum_speed":50,"hitting_power":25,"ball_control":50,"receptions":31,"jerseyNumber":30,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":50,"hitting_power":25,"ball_control":50,"receptions":31}},{"id":813,"team_id":27,"name":"Michael Haynes","position":"RB","position_detail":"RB2","jersey":129,"face":146,"name_rom_offset":11505,"ability_rom_offset":15477,"team_idx":27,"pos_idx":3,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":50,"jerseyNumber":81,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":50}},{"id":814,"team_id":27,"name":"Steve Broussard","position":"RB","position_detail":"RB3","jersey":52,"face":159,"name_rom_offset":11519,"ability_rom_offset":15481,"team_idx":27,"pos_idx":4,"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":25,"ball_control":50,"receptions":31,"jerseyNumber":34,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":25,"ball_control":50,"receptions":31}},{"id":815,"team_id":27,"name":"Keith Jones","position":"RB","position_detail":"RB4","jersey":56,"face":153,"name_rom_offset":11534,"ability_rom_offset":15485,"team_idx":27,"pos_idx":5,"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":31,"ball_control":50,"receptions":25,"jerseyNumber":38,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":38,"hitting_power":31,"ball_control":50,"receptions":25}},{"id":816,"team_id":27,"name":"Floyd Dixon","position":"WR","position_detail":"WR1","jersey":134,"face":141,"name_rom_offset":11545,"ability_rom_offset":15489,"team_idx":27,"pos_idx":6,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":50,"jerseyNumber":86,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":13,"ball_control":50,"receptions":50}},{"id":817,"team_id":27,"name":"Andre Rison","position":"WR","position_detail":"WR2","jersey":128,"face":211,"name_rom_offset":11556,"ability_rom_offset":15493,"team_idx":27,"pos_idx":7,"rushing_power":69,"running_speed":44,"maximum_speed":63,"hitting_power":13,"ball_control":50,"receptions":75,"jerseyNumber":80,"ratings":{"rushing_power":69,"running_speed":44,"maximum_speed":63,"hitting_power":13,"ball_control":50,"receptions":75}},{"id":818,"team_id":27,"name":"Tracy Johnson","position":"WR","position_detail":"WR3","jersey":67,"face":198,"name_rom_offset":11567,"ability_rom_offset":15497,"team_idx":27,"pos_idx":8,"rushing_power":69,"running_speed":38,"maximum_speed":31,"hitting_power":50,"ball_control":50,"receptions":25,"jerseyNumber":43,"ratings":{"rushing_power":69,"running_speed":38,"maximum_speed":31,"hitting_power":50,"ball_control":50,"receptions":25}},{"id":819,"team_id":27,"name":"George Thomas","position":"WR","position_detail":"WR4","jersey":137,"face":143,"name_rom_offset":11580,"ability_rom_offset":15501,"team_idx":27,"pos_idx":9,"rushing_power":69,"running_speed":31,"maximum_speed":31,"hitting_power":13,"ball_control":50,"receptions":44,"jerseyNumber":89,"ratings":{"rushing_power":69,"running_speed":31,"maximum_speed":31,"hitting_power":13,"ball_control":50,"receptions":44}},{"id":820,"team_id":27,"name":"Shawn Collins","position":"TE","position_detail":"TE1","jersey":133,"face":134,"name_rom_offset":11593,"ability_rom_offset":15505,"team_idx":27,"pos_idx":10,"rushing_power":69,"running_speed":44,"maximum_speed":50,"hitting_power":13,"ball_control":50,"receptions":50,"jerseyNumber":85,"ratings":{"rushing_power":69,"running_speed":44,"maximum_speed":50,"hitting_power":13,"ball_control":50,"receptions":50}},{"id":821,"team_id":27,"name":"Gary Wilkins","position":"TE","position_detail":"TE2","jersey":135,"face":152,"name_rom_offset":11606,"ability_rom_offset":15509,"team_idx":27,"pos_idx":11,"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":31,"ball_control":50,"receptions":31,"jerseyNumber":87,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":25,"hitting_power":31,"ball_control":50,"receptions":31}},{"id":822,"team_id":27,"name":"Jamie Dukes","position":"OL","position_detail":"C","jersey":100,"face":167,"name_rom_offset":11618,"ability_rom_offset":15513,"team_idx":27,"pos_idx":12,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":50,"jerseyNumber":64,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":50}},{"id":823,"team_id":27,"name":"Houston Hoover","position":"OL","position_detail":"LG","jersey":105,"face":178,"name_rom_offset":11629,"ability_rom_offset":15516,"team_idx":27,"pos_idx":13,"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":44,"jerseyNumber":69,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":19,"hitting_power":44}},{"id":824,"team_id":27,"name":"Bill Fralic","position":"OL","position_detail":"RG","jersey":121,"face":9,"name_rom_offset":11643,"ability_rom_offset":15519,"team_idx":27,"pos_idx":14,"rushing_power":69,"running_speed":25,"maximum_speed":44,"hitting_power":50,"jerseyNumber":79,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":44,"hitting_power":50}},{"id":825,"team_id":27,"name":"Mike Kenn","position":"OL","position_detail":"LT","jersey":120,"face":30,"name_rom_offset":11654,"ability_rom_offset":15522,"team_idx":27,"pos_idx":15,"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":38,"jerseyNumber":78,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":38}},{"id":826,"team_id":27,"name":"Chris Hinton","position":"OL","position_detail":"RT","jersey":113,"face":178,"name_rom_offset":11663,"ability_rom_offset":15525,"team_idx":27,"pos_idx":16,"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":69,"jerseyNumber":71,"ratings":{"rushing_power":69,"running_speed":25,"maximum_speed":31,"hitting_power":69}},{"id":827,"team_id":27,"name":"Tim Green","position":"DL","position_detail":"RE","jersey":153,"face":16,"name_rom_offset":11675,"ability_rom_offset":15528,"team_idx":27,"pos_idx":17,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":50,"pass_interceptions":19,"quickness":56,"jerseyNumber":99,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":50,"pass_interceptions":19,"quickness":56}},{"id":828,"team_id":27,"name":"Tory Epps","position":"DL","position_detail":"NT","jersey":151,"face":172,"name_rom_offset":11684,"ability_rom_offset":15532,"team_idx":27,"pos_idx":18,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":56,"pass_interceptions":19,"quickness":44,"jerseyNumber":97,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":56,"pass_interceptions":19,"quickness":44}},{"id":829,"team_id":27,"name":"Mike Gann","position":"DL","position_detail":"LE","jersey":118,"face":67,"name_rom_offset":11693,"ability_rom_offset":15536,"team_idx":27,"pos_idx":19,"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":50,"pass_interceptions":19,"quickness":56,"jerseyNumber":76,"ratings":{"rushing_power":44,"running_speed":31,"maximum_speed":50,"hitting_power":50,"pass_interceptions":19,"quickness":56}},{"id":830,"team_id":27,"name":"Darion Conner","position":"LB","position_detail":"ROLB","jersey":86,"face":201,"name_rom_offset":11702,"ability_rom_offset":15540,"team_idx":27,"pos_idx":20,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":19,"quickness":31,"jerseyNumber":56,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":19,"quickness":31}},{"id":831,"team_id":27,"name":"John Rade","position":"LB","position_detail":"RILB","jersey":89,"face":18,"name_rom_offset":11715,"ability_rom_offset":15544,"team_idx":27,"pos_idx":21,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":19,"quickness":31,"jerseyNumber":59,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":19,"quickness":31}},{"id":832,"team_id":27,"name":"Jessie Tuggle","position":"LB","position_detail":"LILB","jersey":88,"face":170,"name_rom_offset":11724,"ability_rom_offset":15548,"team_idx":27,"pos_idx":22,"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":38,"pass_interceptions":19,"quickness":50,"jerseyNumber":58,"ratings":{"rushing_power":38,"running_speed":25,"maximum_speed":44,"hitting_power":38,"pass_interceptions":19,"quickness":50}},{"id":833,"team_id":27,"name":"Michael Reid","position":"LB","position_detail":"LOLB","jersey":149,"face":156,"name_rom_offset":11737,"ability_rom_offset":15552,"team_idx":27,"pos_idx":23,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":19,"quickness":31,"jerseyNumber":95,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":38,"pass_interceptions":19,"quickness":31}},{"id":834,"team_id":27,"name":"Deion Sanders","position":"DB","position_detail":"RCB","jersey":33,"face":158,"name_rom_offset":11749,"ability_rom_offset":15556,"team_idx":27,"pos_idx":24,"rushing_power":56,"running_speed":44,"maximum_speed":75,"hitting_power":56,"pass_interceptions":56,"quickness":50,"jerseyNumber":21,"ratings":{"rushing_power":56,"running_speed":44,"maximum_speed":75,"hitting_power":56,"pass_interceptions":56,"quickness":50}},{"id":835,"team_id":27,"name":"Charles Dimry","position":"DB","position_detail":"LCB","jersey":34,"face":138,"name_rom_offset":11762,"ability_rom_offset":15560,"team_idx":27,"pos_idx":25,"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":31,"pass_interceptions":50,"quickness":25,"jerseyNumber":22,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":31,"hitting_power":31,"pass_interceptions":50,"quickness":25}},{"id":836,"team_id":27,"name":"Scott Case","position":"DB","position_detail":"FS","jersey":37,"face":70,"name_rom_offset":11775,"ability_rom_offset":15564,"team_idx":27,"pos_idx":26,"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":31,"pass_interceptions":50,"quickness":25,"jerseyNumber":25,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":38,"hitting_power":31,"pass_interceptions":50,"quickness":25}},{"id":837,"team_id":27,"name":"Brian Jordan","position":"DB","position_detail":"SS","jersey":64,"face":139,"name_rom_offset":11785,"ability_rom_offset":15568,"team_idx":27,"pos_idx":27,"rushing_power":31,"running_speed":25,"maximum_speed":25,"hitting_power":44,"pass_interceptions":50,"quickness":19,"jerseyNumber":40,"ratings":{"rushing_power":31,"running_speed":25,"maximum_speed":25,"hitting_power":44,"pass_interceptions":50,"quickness":19}},{"id":838,"team_id":27,"name":"Greg Davis","position":"K","position_detail":"K","jersey":5,"face":33,"name_rom_offset":11797,"ability_rom_offset":15572,"team_idx":27,"pos_idx":28,"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":25,"avoid_kick_block":50,"jerseyNumber":5,"ratings":{"rushing_power":81,"running_speed":56,"maximum_speed":81,"hitting_power":31,"kicking_ability":25,"avoid_kick_block":50}},{"id":839,"team_id":27,"name":"Scott Fulhage","position":"P","position_detail":"P","jersey":23,"face":12,"name_rom_offset":11807,"ability_rom_offset":15576,"team_idx":27,"pos_idx":29,"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":63,"avoid_kick_block":69,"jerseyNumber":17,"ratings":{"rushing_power":56,"running_speed":25,"maximum_speed":44,"hitting_power":31,"kicking_ability":63,"avoid_kick_block":69}}],"metadata":{"source":"https://github.com/renderorange/tecmo-super-bowl-automator/blob/b2e1c5a2fa25dbb430331e971834b7d65dafc622/src/db/seeds/teams_with_attributes.json","sourceCommit":"b2e1c5a2fa25dbb430331e971834b7d65dafc622","sourceSha256":"e4e0a1e10ce4b8a382c87a4fc615c6bb4e924607b7dacfe864dadbc981ed9727","sourceLicense":"MIT; see data/roster-source.LICENSE","sourceExtractedAt":"2026-03-19T04:23:12.411Z","edition":"Tecmo Super Bowl, NES, USA, original 28-team roster","teamCount":28,"playerCount":840,"ratingScale":[6,13,19,25,31,38,44,50,56,63,69,75,81,88,94,100],"jerseyEncoding":"Source jersey is packed BCD; jerseyNumber is the decoded decimal number.","verification":{"rosterSourceCommit":"b2e1c5a2fa25dbb430331e971834b7d65dafc622","rosterSourceSha256":"e4e0a1e10ce4b8a382c87a4fc615c6bb4e924607b7dacfe864dadbc981ed9727","disassemblyCommit":"f3bae0e1913ba532a5ace158d86d905ecf787008","disassemblyFile":"Bank1_2_team_data.asm","disassemblySha256":"efecfeaba13b125a2261979f2d5e48e2351c9f2687e3f28980cb54d3a32d8348","playersCompared":840,"playerNamesMatched":840,"packedJerseysMatched":840,"positionsMatched":840,"faceIdentifiersMatched":840,"ratingValuesMatched":4872,"mismatches":0,"nameComparison":"Case and whitespace ignored; punctuation and letters preserved.","teamMetadataCompared":false,"localRomCompared":false}}};
  data.teams.forEach(team => { team.roster = data.players.filter(player => player.team_id === team.id); });
  root.TECMO_ROSTERS = data;
  if (typeof module !== "undefined" && module.exports) module.exports = data;
})(typeof window !== "undefined" ? window : globalThis);


;/* src/nes-state.js */
/* Read-only NES Tecmo Super Bowl state projection.
   This adapter never replaces, patches, or advances the emulated game logic.
   Offsets were verified against the bruddog disassembly at commit
   f3bae0e1913ba532a5ace158d86d905ecf787008. See NES_MEMORY_MAP.md.
   The renderer's 3D coordinates are a view transform, not emulated RAM. */
(function (root) {
  'use strict';

  const MAP = Object.freeze({
    gameStatus: 0x2d, softPpuCtrl: 0x31, frame: 0x30,
    updatePlayersTask: 0x20, updatePlayersTaskA000Bank: 0x24,
    scrollX: 0x54, scrollY: 0x57, clockRunType: 0x69,
    seconds: 0x6a, minutes: 0x6b, teamIds: 0x6c,
    statisticsOffenseSide: 0x6f, possessionStatus: 0x70,
    playStatus: 0x71, ballStatus: 0x72, ballSpecialStatus: 0x73,
    teamControlTypes: 0x75, quarter: 0x76, down: 0x77,
    playCalls: 0x78, losX: 0x7f, losY: 0x81, firstDownStartX: 0x82,
    controlledPointers: 0x84, controlledIconIds: 0x88,
    ballCollision: 0x8e, ballY: 0x8f, ballX: 0x92, ballZ: 0xa1,
    playerRam: 0x39f, playerStride: 0x20, playerCount: 22,
    scores: Object.freeze([0x399, 0x39e]),
    passTargetIndex: 0x683, passTargets: 0x684,
    starterTables: Object.freeze([0x6610, 0x6644]),
    player: Object.freeze({ collision: 0x00, movement: 0x01,
      position: 0x08, spriteIndex: 0x0c, extraSpriteIndex: 0x0d,
      direction: 0x0e, currentSpeed: 0x11, maxSpeed: 0x12,
      x: 0x13, y: 0x16, vx: 0x18, vy: 0x1a }),
    field: Object.freeze({ leftGoal: 0x670, rightGoal: 0x990,
      lateralCenter: 0x78, lateralTop: 0x28, lateralBottom: 0xc8,
      unitsPerYard: 8, lateralYardsPerUnit: 53.3 / 160 })
  });
  const TEAM_IDS = [
    ['BUF', 'BUFFALO', 'Bills'], ['IND', 'INDIANAPOLIS', 'Colts'],
    ['MIA', 'MIAMI', 'Dolphins'], ['NE', 'NEW ENGLAND', 'Patriots'],
    ['NYJ', 'NEW YORK', 'Jets'], ['CIN', 'CINCINNATI', 'Bengals'],
    ['CLE', 'CLEVELAND', 'Browns'], ['HOU', 'HOUSTON', 'Oilers'],
    ['PIT', 'PITTSBURGH', 'Steelers'], ['DEN', 'DENVER', 'Broncos'],
    ['KC', 'KANSAS CITY', 'Chiefs'], ['LAR', 'LOS ANGELES', 'Raiders'],
    ['SD', 'SAN DIEGO', 'Chargers'], ['SEA', 'SEATTLE', 'Seahawks'],
    ['WAS', 'WASHINGTON', 'Washington'], ['NYG', 'NEW YORK', 'Giants'],
    ['PHI', 'PHILADELPHIA', 'Eagles'], ['PHX', 'PHOENIX', 'Cardinals'],
    ['DAL', 'DALLAS', 'Cowboys'], ['CHI', 'CHICAGO', 'Bears'],
    ['DET', 'DETROIT', 'Lions'], ['GB', 'GREEN BAY', 'Packers'],
    ['MIN', 'MINNESOTA', 'Vikings'], ['TB', 'TAMPA BAY', 'Buccaneers'],
    ['SF', 'SAN FRANCISCO', '49ers'], ['LAM', 'LOS ANGELES', 'Rams'],
    ['NO', 'NEW ORLEANS', 'Saints'], ['ATL', 'ATLANTA', 'Falcons'],
    ['AFC', 'AFC', 'Pro Bowl'], ['NFC', 'NFC', 'Pro Bowl']
  ];
  const OFF_POSITIONS = ['QB', 'RB1', 'RB2', 'WR1', 'WR2', 'TE', 'C', 'LG', 'RG', 'LT', 'RT'];
  const DEF_POSITIONS = ['RE', 'NT', 'LE', 'ROLB', 'RILB', 'LILB', 'LOLB', 'RCB', 'LCB', 'FS', 'SS'];
  const OFF_ROLES = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'OL', 'OL', 'OL', 'OL', 'OL'];
  const DEF_ROLES = ['DL', 'DL', 'DL', 'LB', 'LB', 'LB', 'LB', 'CB', 'CB', 'S', 'S'];
  const byte = (mem, address) => (mem[address] || 0) & 255;
  const word = (mem, address) => byte(mem, address) + byte(mem, address + 1) * 256;
  const fixed16 = (mem, address) => byte(mem, address + 1) + byte(mem, address) / 256;
  const fixed24 = (mem, address) => word(mem, address + 1) + byte(mem, address) / 256;
  const signedFixed16 = (mem, address) => { const value = word(mem, address); return (value >= 0x8000 ? value - 0x10000 : value) / 256; };
  const bcd = value => ((value >> 4) <= 9 && (value & 15) <= 9) ? (value >> 4) * 10 + (value & 15) : null;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const pointerIndex = pointer => {
    const index = (pointer - MAP.playerRam) / MAP.playerStride;
    return Number.isInteger(index) && index >= 0 && index < MAP.playerCount ? index : -1;
  };

  class TecmoNesState {
    constructor(rosterDB = root.TECMO_ROSTERS || null) {
      this.rosterDB = rosterDB;
      this.last = null;
    }

    _team(id, side) {
      const label = TEAM_IDS[id] || ['P' + (side + 1), 'PLAYER ' + (side + 1), ''];
      const teams = this.rosterDB && this.rosterDB.teams;
      const entry = Array.isArray(teams) ? (teams.find(t => t && (t.id === id || t.teamId === id || t.abbr === label[0] || t.abbreviation === label[0])) || teams[id]) : (teams && (teams[id] || teams[label[0]]));
      return { ...(entry || {}), id, nesTeamId: id,
        abbr: entry && (entry.abbr || entry.abbreviation) || label[0],
        city: entry && entry.city || label[1],
        name: entry && entry.name || label[2],
        // HUD metadata only; authentic player colors come from the PPU.
        primary: entry && entry.primary || (side ? '#bc303c' : '#285cc4'),
        secondary: entry && entry.secondary || '#ececec' };
    }

    _rosterPlayer(teamId, rosterId) {
      if (!this.rosterDB || rosterId < 0 || rosterId >= 30) return null;
      const team = this._team(teamId, 0);
      const roster = team.roster || team.players;
      if (Array.isArray(roster)) return roster.find(p => p && (p.rosterId === rosterId || p.rosterIndex === rosterId)) || roster[rosterId] || null;
      if (roster && typeof roster === 'object') return roster[rosterId] || null;
      const players = this.rosterDB.players;
      if (Array.isArray(players)) return players.find(p => p && (p.teamId === teamId || p.nesTeamId === teamId) && (p.rosterId === rosterId || p.rosterIndex === rosterId)) || null;
      return null;
    }

    read(source) {
      const nes = source && source.cpu ? source : null;
      const mem = nes ? nes.cpu.mem : source;
      if (!mem || typeof mem.length !== 'number' || mem.length < 0x800) throw new TypeError('TecmoNesState.read needs CPU memory (at least 2 KiB) or a NES object with cpu.mem.');
      const gameStatus = byte(mem, MAP.gameStatus);
      const possessionStatus = byte(mem, MAP.possessionStatus);
      const playStatus = byte(mem, MAP.playStatus);
      const ballCollision = byte(mem, MAP.ballCollision);
      // Bit 7 is the original/last offensive side; bit 6 is the current ball
      // side. Keeping axes based on bit 7 prevents an INT return flipping the
      // entire view mid-play. $6F is a statistics scratch value, not this bit.
      const possession = (possessionStatus & 0x80) ? 1 : 0;
      const ballPossession = (possessionStatus & 0x40) ? 1 : 0;
      const direction = possession ? -1 : 1;
      const controlledPointers = [word(mem, MAP.controlledPointers), word(mem, MAP.controlledPointers + 2)];
      const controlledIndices = controlledPointers.map(pointerIndex);
      const nativeScrollX = word(mem, MAP.scrollX);
      const nativeScrollY = word(mem, MAP.scrollY);
      const zFromX = x => direction === 1 ? (x - MAP.field.leftGoal) / 8 : (MAP.field.rightGoal - x) / 8;
      const xFromY = y => (y - MAP.field.lateralCenter) * MAP.field.lateralYardsPerUnit * direction;
      const typeBits = possessionStatus & 0x1c;
      const flagKind = typeBits === 0x08 ? 'kickoff' : typeBits === 0x0c ? 'punt' : typeBits === 0x10 ? 'fieldgoal' : typeBits === 0x14 ? 'extrapoint' : (typeBits & 0x04) ? 'pass' : 'run';
      const offensePlayCall = byte(mem, MAP.playCalls + possession);
      // The ROM initializes $70's play type after the hike check returns.
      // During a new regular formation it can still say "kickoff" or "pass"
      // from the preceding play. Kickoff explicitly controls the receiving
      // side's final (KR) record; ordinary formations control its first QB/P
      // record. Combine that documented context with original play-call IDs.
      const kickoffFormation = controlledIndices[possession] === possession * 11 + 10;
      const pendingPlayCall = !(playStatus & 0x06) && flagKind !== 'extrapoint' &&
        (flagKind !== 'kickoff' || (controlledIndices[possession] >= 0 && !kickoffFormation));
      const kind = pendingPlayCall && offensePlayCall <= 9 ?
        offensePlayCall === 9 ? 'fieldgoal' : offensePlayCall === 8 ? 'punt' : offensePlayCall >= 4 ? 'pass' : 'run' : flagKind;
      const players = [];
      const hasStarterRAM = mem.length > 0x6677;
      for (let i = 0; i < MAP.playerCount; i++) {
        const address = MAP.playerRam + i * MAP.playerStride;
        const team = i < 11 ? 0 : 1, positionIndex = i % 11;
        const offense = team === possession;
        const nativeX = fixed24(mem, address + MAP.player.x);
        const nativeY = fixed16(mem, address + MAP.player.y);
        const movement = byte(mem, address + MAP.player.movement);
        const collision = byte(mem, address + MAP.player.collision);
        const nativeDirection = byte(mem, address + MAP.player.direction);
        const nativeVX = signedFixed16(mem, address + MAP.player.vx);
        const nativeVY = signedFixed16(mem, address + MAP.player.vy);
        let starterIndex = positionIndex + (offense ? 0 : 11);
        let role = (offense ? OFF_ROLES : DEF_ROLES)[positionIndex];
        let positionName = (offense ? OFF_POSITIONS : DEF_POSITIONS)[positionIndex];
        if ((kind === 'fieldgoal' || kind === 'extrapoint') && offense && positionIndex === 1) { starterIndex = 22; role = 'K'; positionName = 'K'; }
        if (kind === 'punt' && offense && positionIndex === 0) { starterIndex = 23; role = 'P'; positionName = 'P'; }
        if (kind === 'punt' && !offense && positionIndex === 10) { starterIndex = 25; role = 'RB'; positionName = 'PR'; }
        if (kind === 'kickoff' && !offense && positionIndex === 0) { starterIndex = 22; role = 'K'; positionName = 'K'; }
        if (kind === 'kickoff' && offense && positionIndex === 10) { starterIndex = 24; role = 'RB'; positionName = 'KR'; }
        const starterAddress = MAP.starterTables[team] + starterIndex * 2;
        const rosterTeamId = hasStarterRAM ? byte(mem, starterAddress) : byte(mem, MAP.teamIds + team);
        const rosterId = hasStarterRAM ? byte(mem, starterAddress + 1) : null;
        const rosterPlayer = rosterId === null ? null : this._rosterPlayer(rosterTeamId, rosterId);
        const numberValue = rosterPlayer && (rosterPlayer.number ?? rosterPlayer.jerseyNumber ?? rosterPlayer.jersey);
        const number = numberValue !== undefined && numberValue !== null && Number.isFinite(Number(numberValue)) ? Number(numberValue) : null;
        const faceValue = rosterPlayer && rosterPlayer.face;
        const face = faceValue !== undefined && faceValue !== null && Number.isFinite(Number(faceValue)) ? Number(faceValue) : null;
        const theta = nativeDirection * Math.PI * 2 / 256;
        const nativePositionId = byte(mem, address + MAP.player.position);
        const valid = nativeX >= 0x600 && nativeX <= 0xa00 && nativeY >= 8 && nativeY <= 248 && (nativePositionId & 0x1f) < 11;
        players.push({ id: i, team, role, positionName, positionIndex, nativePositionId, address,
          x: xFromY(nativeY), z: zFromX(nativeX),
          nativeX, nativeY, nativeDirection, nativeVX, nativeVY,
          screenX: Math.floor(nativeX) - nativeScrollX - 8,
          screenY: Math.floor(nativeY) + 1,
          screenFootX: Math.floor(nativeX) - nativeScrollX,
          screenFootY: Math.floor(nativeY) + 17,
          spriteIndex: byte(mem, address + MAP.player.spriteIndex),
          extraSpriteIndex: byte(mem, address + MAP.player.extraSpriteIndex),
          hasBall: !!(movement & 0x20), stunned: collision & 0x10 ? 1 : 0,
          moving: !!(movement & 0x80), movementStatus: movement, collisionStatus: collision,
          // The NES field is laterally compressed, so diagonal facing must
          // use the same unequal axis scales as positions and velocities.
          heading: Math.atan2(-Math.sin(theta) * MAP.field.lateralYardsPerUnit * direction, -Math.cos(theta) / 8 * direction),
          vx: nativeVY * MAP.field.lateralYardsPerUnit * direction * 60,
          vz: nativeVX / 8 * direction * 60,
          speed: byte(mem, address + MAP.player.currentSpeed),
          maxSpeed: byte(mem, address + MAP.player.maxSpeed),
          starterIndex, rosterTeamId, rosterId,
          name: rosterPlayer && (rosterPlayer.name || rosterPlayer.playerName) || null,
          number, face, valid, nativeSprite: null });
      }
      const controlled = controlledIndices[0] >= 0 && controlledIndices[0] < 11 ? players[controlledIndices[0]] : players[0];
      const carrier = players.find(p => p.valid && p.team === ballPossession && p.hasBall) || null;
      const nativeBallX = fixed24(mem, MAP.ballX), nativeBallY = fixed24(mem, MAP.ballY), nativeBallZ = fixed24(mem, MAP.ballZ);
      const flight = !!(ballCollision & 0x80);
      const ball = { x: carrier && !flight ? carrier.x : xFromY(nativeBallY),
        z: carrier && !flight ? carrier.z : zFromX(nativeBallX),
        // NES loft is screen elevation above its flat-field trajectory. Add
        // it to the same presentation height used for a carried ball so the
        // ball-following camera stays continuous at release and reception.
        y: 1.35 + (flight ? Math.max(0, nativeBallZ / 8) : 0),
        flight, nativeX: nativeBallX, nativeY: nativeBallY, nativeZ: nativeBallZ,
        screenX: Math.floor(nativeBallX) - nativeScrollX - 4,
        screenY: Math.floor(nativeBallY - nativeBallZ) + 3 };
      const nativeLosX = word(mem, MAP.losX), nativeFirstDownStartX = word(mem, MAP.firstDownStartX);
      const nativeLineToGainX = nativeFirstDownStartX + direction * 80;
      const los = zFromX(nativeLosX);
      const targetZ = Math.min(100, zFromX(nativeLineToGainX));
      const toGo = Math.max(0, Math.ceil(targetZ - los));
      const targetIds = Array.from({ length: 5 }, (_, i) => byte(mem, MAP.passTargets + i));
      const targetPlayers = targetIds.map(id => {
        const position = id & 0x1f, side = id & 0x80 ? 1 : 0;
        return position > 0 && position < 11 ? players[side * 11 + position] : null;
      });
      let receivers = targetPlayers.filter(p => p && p.team === possession);
      if (!receivers.length) receivers = players.filter(p => p.team === possession && p.positionIndex >= 1 && p.positionIndex <= 5);
      if (kind !== 'pass') receivers = [];
      const nativeTargetSlot = byte(mem, MAP.passTargetIndex);
      const selectedPlayer = nativeTargetSlot >= 1 && nativeTargetSlot <= 5 ? targetPlayers[nativeTargetSlot - 1] : null;
      const selectedReceiver = selectedPlayer ? receivers.indexOf(selectedPlayer) : -1;
      const secondsBCD = byte(mem, MAP.seconds), minutesBCD = byte(mem, MAP.minutes);
      const seconds = bcd(secondsBCD), minutes = bcd(minutesBCD);
      const clock = seconds !== null && minutes !== null && seconds < 60 ? minutes * 60 + seconds : 0;
      const nativeQuarter = byte(mem, MAP.quarter), nativeDown = byte(mem, MAP.down);
      const rawScore = MAP.scores.map(address => byte(mem, address));
      const scores = rawScore.map(value => bcd(value) ?? 0);
      const validPlayers = players.filter(p => p.valid).length;
      const fieldFlag = !!(gameStatus & 0x80);
      // These additional gates avoid drawing stale field RAM in native menus.
      // Bit 5 of PPUCTRL selects the game's two 8x16 player sprites.
      const sprites8x16 = !!(byte(mem, MAP.softPpuCtrl) & 0x20);
      const playerTaskStatus = byte(mem, MAP.updatePlayersTask);
      const playerTaskBank = byte(mem, MAP.updatePlayersTaskA000Bank);
      const playerTaskActive = playerTaskStatus !== 0 && (playerTaskBank === 20 || playerTaskBank === 21);
      const validControlPointer = controlledIndices[0] >= 0 && controlledIndices[0] < 11;
      const isOnField = fieldFlag && sprites8x16 && playerTaskActive && validPlayers >= 11 && validControlPointer && controlled.valid;
      const phase = !isOnField ? 'playcall' : (playStatus & 0x80) ? 'dead' : (playStatus & 0x04) ? 'live' : 'presnap';
      const humanTeam = this._team(byte(mem, MAP.teamIds), 0), cpuTeam = this._team(byte(mem, MAP.teamIds + 1), 1);
      const state = { authentic: true, isOnField, direction, possession, ballPossession,
        players, controlled, carrier, receivers, selectedReceiver, ball,
        phase, los: clamp(los, 0, 100), toGo: clamp(toGo, 0, 100),
        down: nativeDown <= 3 ? nativeDown + 1 : 1,
        quarter: nativeQuarter <= 4 ? nativeQuarter + 1 : 1,
        overtime: nativeQuarter === 4, clock, clockSeconds: clock, scores,
        humanTeam, cpuTeam, practice: false, isDefense: possession === 1,
        playClock: 0, playIndex: offensePlayCall,
        play: { type: kind === 'pass' ? 'pass' : 'run', kind, name: 'NES ' + kind.toUpperCase(), description: 'Original NES game logic' },
        message: phase === 'live' ? 'NES GAMEPLAY' : phase === 'presnap' ? 'READY TO SNAP' : phase === 'dead' ? 'PLAY OVER' : 'NES MENUS',
        detail: '', events: [], lastResult: null,
        raw: { gameStatus, possessionStatus, playStatus, ballStatus: byte(mem, MAP.ballStatus),
          ballSpecialStatus: byte(mem, MAP.ballSpecialStatus), ballCollision,
          frame: byte(mem, MAP.frame), fieldFlag, sprites8x16, validPlayers,
          playerTaskStatus, playerTaskBank, playerTaskActive, validControlPointer,
          softPpuCtrl: byte(mem, MAP.softPpuCtrl), nativeScrollX, nativeScrollY,
          nativeLosX, nativeLosY: byte(mem, MAP.losY), nativeFirstDownStartX, nativeLineToGainX,
          controlledPointers, controlledIndices, targetIds, nativeTargetSlot,
          typeBits, flagKind, pendingPlayCall, offensePlayCall, kickoffFormation,
          statisticsOffenseSide: byte(mem, MAP.statisticsOffenseSide),
          teamControlTypes: byte(mem, MAP.teamControlTypes),
          clockRunType: byte(mem, MAP.clockRunType), secondsBCD, minutesBCD,
          nativeQuarter, nativeDown, rawScore,
          taskStatuses: [0x02, 0x07, 0x0c, 0x11, 0x16, 0x1b, 0x20, 0x25].map(a => byte(mem, a)) } };
      this.last = state;
      return state;
    }

    state(source) { return this.read(source); }

    // Turn a renderer-space direction into original NES D-pad axes. Diagonal
    // vectors remain diagonal; the input layer supplies button presses only.
    static nativeInput(moveX, moveZ, direction = 1) {
      const sign = direction < 0 ? -1 : 1;
      return { x: moveZ * sign, y: moveX * sign };
    }
  }
  TecmoNesState.MAP = MAP;
  TecmoNesState.TEAM_IDS = TEAM_IDS;
  TecmoNesState.decodeBCD = bcd;
  root.TecmoNesState = TecmoNesState;
  if (typeof module !== 'undefined' && module.exports) module.exports = { TecmoNesState, MAP };
})(typeof window !== 'undefined' ? window : globalThis);


;/* src/nes-sprites.js */
/* Decode runtime OAM/CHR data from the user's loaded ROM. No art is bundled. */
(function (root) {
  'use strict';

  const FIELD_OAM_START = 0x30;
  const FIELD_OAM_END = 0xd8;
  const MATCH_RADIUS = 12;
  const MAX_ANIMATION_FRAMES = 32;
  const SOURCE = 'https://github.com/bruddog/Tecmo_Super_Bowl_NES_Disassembly/blob/f3bae0e1913ba532a5ace158d86d905ecf787008';
  // These short signatures identify data structures, not image assets. All
  // tile descriptors and pixels below are read from the user's loaded ROM.
  const STANDING_SIGNATURE = [0x51, 0x53, 0, 0x10, 0x5d, 0x5f, 0, 0x10];
  const RUNNING_SIGNATURE = [1, 3, 0, 0, 0x0d, 0x0f, 0, 0];
  const FIELD_PALETTE_SIGNATURE = [15, 33, 37, 48, 15, 17, 37, 48, 15, 26, 17, 48, 15, 55, 36, 48];
  const findBytes = (data, bytes, start = 0) => {
    if (!data) return -1;
    outer: for (let i = start; i <= data.length - bytes.length; i++) {
      for (let j = 0; j < bytes.length; j++) if (data[i + j] !== bytes[j]) continue outer;
      return i;
    }
    return -1;
  };
  const normalOffset = value => Number.isInteger(value) && value >= FIELD_OAM_START && value <= FIELD_OAM_END && value % 8 === 0;
  const extraOffset = value => Number.isInteger(value) && value >= 0x10 && value <= 0x28 && value % 8 === 0;

  class TecmoNesSprites {
    constructor() {
      this.availableCount = 0;
      this.matchedCount = 0;
      this.reusedCount = 0;
      this.cache = new Map();
      this.nes = null;
      this.teamSignature = '';
      this.stadiumSprite = null;
      this.stadiumMeta = null;
      this.stadiumHash = null;
      this.viewCache = new Map();
      this.romTables = null;
      this.fieldAtlas = null;
      this.fieldPaletteKey = '';
      this.state = null;
    }

    clear() {
      this.cache.clear();
      this.availableCount = 0;
      this.matchedCount = 0;
      this.reusedCount = 0;
      this.stadiumSprite = null;
      this.stadiumMeta = null;
      this.stadiumHash = null;
      this.viewCache.clear();
      this.romTables = null;
      this.fieldAtlas = null;
      this.fieldPaletteKey = '';
      this.state = null;
    }

    _tables(nes) {
      if (this.romTables) return this.romTables;
      const players = nes?.rom?.rom?.[10];
      const field = nes?.rom?.rom?.[11];
      const standing = findBytes(players, STANDING_SIGNATURE);
      const running = standing < 0 ? -1 : standing + 32;
      const fieldPalette = findBytes(field?.subarray?.(0, 8192) || field, FIELD_PALETTE_SIGNATURE);
      if (standing < 0 || findBytes(players, RUNNING_SIGNATURE, running) !== running) return null;
      this.romTables = { players, standing, running, field, fieldPalette };
      return this.romTables;
    }

    _romTile(nes, bank, localTile) {
      // MMC3 bank numbers are 1 KiB units; JSNES stores CHR in 4 KiB pages.
      const tileBank = bank + (localTile >> 6);
      return nes?.rom?.vromTile?.[tileBank >> 2]?.[(tileBank & 3) * 64 + (localTile & 63)]?.pix || null;
    }

    _canvas(width, height, pixels) {
      const canvas = root.document?.createElement('canvas') || (root.OffscreenCanvas ? new root.OffscreenCanvas(width, height) : null);
      if (!canvas) return null;
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      const image = ctx.createImageData(width, height);
      image.data.set(pixels); ctx.putImageData(image, 0, 0);
      return canvas;
    }

    viewSprite(player, cameraYaw = 0) {
      const fallback = () => player?.nativeSprite ? { canvas: player.nativeSprite, ...player.nativeSpriteMeta,
        source: 'nes-oam', facing: this._class(player).facing, cameraRelative: false } : null;
      const nes = this.nes, tables = this._tables(nes);
      if (!player || !tables || !Number.isFinite(player.heading) || !Number.isFinite(cameraYaw)) return fallback();
      const context = this._class(player);
      // Keep exact OAM jump/dive/action composites when their camera-relative
      // multi-sprite layout has not been verified. No substitute art is drawn.
      if (context.pose === 'ground' || context.pose === 'airborne') return fallback();
      // ROM directions: left, left/up, up (back), up/right, right,
      // right/down, down (front), down/left. A chase sees the player's back.
      const facing = ((Math.round((Math.PI / 2 + player.heading - cameraYaw) / (Math.PI / 4)) % 8) + 8) % 8;
      const moving = context.pose === 'moving';
      const pose = moving ? 'running' : 'standing';
      const address = (moving ? tables.running : tables.standing) + facing * 4;
      const descriptor = tables.players.subarray(address, address + 4);
      if (descriptor.length !== 4 || descriptor[2] !== 0) return fallback();
      const skin = context.skin ?? (player.nativeSpriteMeta?.paletteIds?.[0] & 1) ?? 0;
      const palette = (player.team === 1 ? 2 : 0) + skin;
      const colors = nes.ppu?.sprPalette?.slice(palette * 4, palette * 4 + 4);
      if (!colors || colors.length !== 4) return fallback();
      const runningBank = nes.cpu?.mem?.[0x4b];
      if (moving && (!Number.isInteger(runningBank) || runningBank > 5)) return fallback();
      const key = [pose, facing, palette, moving ? runningBank : 9, ...colors].join(':');
      if (this.viewCache.has(key)) return this.viewCache.get(key);
      const data = new Uint8ClampedArray(16 * 16 * 4);
      const mirror = (descriptor[3] & 0x80) !== 0;
      for (let half = 0; half < 2; half++) {
        const tile = descriptor[half] & 0xfe;
        const region = tile >> 6;
        // Ordinary standing/running bodies use the ROM's $1000 or $1400
        // pattern region. Front/rear presnap stances do not exist in the NES
        // art, so those angles use its genuine eight-direction standing pose.
        const bank = region === 0 ? runningBank : region === 1 ? 9 : null;
        if (bank === null) return fallback();
        for (let y = 0; y < 16; y++) {
          const pixels = this._romTile(nes, bank, (tile & 63) + (y >> 3));
          if (!pixels) return fallback();
          for (let x = 0; x < 8; x++) {
            const colorIndex = pixels[(y & 7) * 8 + (mirror ? 7 - x : x)] & 3;
            if (colorIndex === 0) continue;
            const color = colors[colorIndex], target = (y * 16 + half * 8 + x) * 4;
            data[target] = color & 255; data[target + 1] = (color >>> 8) & 255;
            data[target + 2] = (color >>> 16) & 255; data[target + 3] = 255;
          }
        }
      }
      const canvas = this._canvas(16, 16, data);
      if (!canvas) return fallback();
      const image = { canvas, source: 'nes-rom-directional', sourceReference: SOURCE + '/Bank21_22_play_commands_on_field_logic.asm',
        facing, pose, cameraRelative: true, width: 16, height: 16, anchorX: 8, anchorY: 16,
        descriptorOffset: 10 * 16384 + address, chrBank: moving ? runningBank : 9, skinPalette: skin,
        poseFallback: this.state?.phase === 'presnap' ? 'NES standing pose; front/rear stance art unavailable' : null };
      if (this.viewCache.size >= 512) this.viewCache.delete(this.viewCache.keys().next().value);
      this.viewCache.set(key, image);
      return image;
    }

    captureField(nes, state) {
      const signature = [state?.humanTeam?.abbr ?? '', state?.cpuTeam?.abbr ?? ''].join(':');
      if (nes !== this.nes || signature !== this.teamSignature) {
        this.clear(); this.nes = nes; this.teamSignature = signature;
      }
      if (!state?.isOnField) return null;
      const tables = this._tables(nes), paletteTable = nes?.ppu?.palTable;
      if (!tables || tables.fieldPalette < 0 || typeof paletteTable?.getEntry !== 'function') return null;
      const source = tables.field, paletteAt = tables.fieldPalette;
      const palette = Array.from(source.subarray(paletteAt, paletteAt + 16), color => paletteTable.getEntry(color));
      const rightGrass = paletteTable.getEntry(0x1a);
      const paletteKey = palette.join(':') + ':' + rightGrass;
      if (this.fieldAtlas && this.fieldPaletteKey === paletteKey) return this.fieldAtlas;
      // Bank23: 64 column IDs -> 35 six-metatile columns -> attribute byte
      // and sixteen 8x8 tile IDs per 32x32 metatile. Decode background only:
      // no players, transient scrimmage arrows, HUD or overlays are captured.
      const mapAt = paletteAt + 16 + 15, columnsAt = mapAt + 64, tilesAt = columnsAt + 35 * 8;
      if (tilesAt + 146 * 17 > source.length) return null;
      const width = 1024, height = 160, nativeLeftX = 1536, nativeTopY = 40;
      const data = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        // Player RAM Y locates the top of its 16px body. A ground contact at
        // that coordinate lies sixteen pixels lower in the native background.
        // Native metatile columns begin 16px left of their gameplay X. The
        // goal line is the first column of metatile$05 ($660 + $10 = $670).
        const nx = nativeLeftX + x - 16, ny = nativeTopY + y + 16;
        const column = source[mapAt + (nx >> 5) - 32];
        const metatile = source[columnsAt + column * 8 + ((ny - 32) >> 5)];
        const metaAt = tilesAt + metatile * 17, tx = (nx & 31) >> 3, ty = ((ny - 32) & 31) >> 3;
        const tile = source[metaAt + 1 + ty * 4 + tx];
        const attribute = source[metaAt], paletteId = (attribute >> ((ty >> 1) * 4 + (tx >> 1) * 2)) & 3;
        // Field IRQ's bank0 value is a keep-current sentinel, not CHR bank0.
        // Native left/right endzone+crowd banks $14/$10 provide grass and
        // yard glyphs; fixed bank$1C supplies NFL/TECMO logos and endzone text.
        const bank = tile >= 128 ? 0x1c : nx >= 2432 ? 0x10 : 0x14;
        const pixels = this._romTile(nes, bank, tile & 127);
        if (!pixels) return null;
        const colorIndex = pixels[(ny & 7) * 8 + (nx & 7)] & 3;
        // Original field commands change palette1/color1 from shield blue to
        // grass green when the right-endzone region enters the camera. Apply
        // that local color to the full atlas, preserving the midfield shield.
        const color = paletteId === 1 && colorIndex === 1 && nx >= 0x850 ? rightGrass : palette[paletteId * 4 + colorIndex];
        const dest = (y * width + x) * 4;
        data[dest] = color & 255; data[dest + 1] = (color >>> 8) & 255;
        data[dest + 2] = (color >>> 16) & 255; data[dest + 3] = 255;
      }
      this.fieldPaletteKey = paletteKey;
      this.fieldAtlas = { width, height, data, canvas: this._canvas(width, height, data), nativeLeftX, nativeTopY,
        nativePixelsPerYard: 8, nativeLateralPixels: 160, nativeFootOffsetY: 16, nativeTileOffsetX: -16, fieldWidthYards: 53.3,
        source: 'nes-rom-background', sourceReference: SOURCE + '/Bank23_draw_field_ball_ani_coll_check.asm',
        paletteOffset: 11 * 16384 + paletteAt, minZ: -14, maxZ: 114, minX: -26.65, maxX: 26.65 };
      return this.fieldAtlas;
    }

    captureStadium(nes, state) {
      // The stock on-field IRQ layout puts two rows of crowd tiles directly
      // below its HUD: visible x=8..247, y=32..47. Rows 48+ contain the pitch.
      // Capture the actual rendered band, including the ROM's animated colors.
      const teamSignature = [state?.humanTeam?.abbr ?? '', state?.cpuTeam?.abbr ?? ''].join(':');
      if (nes !== this.nes || teamSignature !== this.teamSignature) {
        this.clear(); this.nes = nes; this.teamSignature = teamSignature;
      }
      const buffer = nes?.ppu?.buffer;
      if (!state?.isOnField || !buffer || buffer.length < 256 * 240 || nes.ppu.f_bgVisibility === 0) return this.stadiumSprite;
      const rect = { x: 8, y: 32, width: 240, height: 16 };
      let hash = 2166136261, opaque = 0;
      const colors = new Set();
      for (let y = rect.y; y < rect.y + rect.height; y++) for (let x = rect.x; x < rect.x + rect.width; x++) {
        const color = buffer[y * 256 + x] & 0xffffff;
        hash = Math.imul(hash ^ color, 16777619);
        if (color !== 0) opaque++;
        colors.add(color);
      }
      // Do not replace a real crowd with a black transition frame or empty
      // fixture output while RAM still briefly describes an on-field scene.
      if (opaque < rect.width * rect.height / 10 || colors.size < 4) return this.stadiumSprite;
      hash >>>= 0;
      if (hash === this.stadiumHash && this.stadiumSprite) return this.stadiumSprite;
      const canvas = this.stadiumSprite || root.document?.createElement('canvas') || (root.OffscreenCanvas ? new root.OffscreenCanvas(rect.width, rect.height) : null);
      if (!canvas) return null;
      canvas.width = rect.width; canvas.height = rect.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      const image = ctx.createImageData(rect.width, rect.height);
      for (let y = 0; y < rect.height; y++) for (let x = 0; x < rect.width; x++) {
        const color = buffer[(rect.y + y) * 256 + rect.x + x];
        const index = (y * rect.width + x) * 4;
        image.data[index] = color & 255;
        image.data[index + 1] = (color >>> 8) & 255;
        image.data[index + 2] = (color >>> 16) & 255;
        image.data[index + 3] = 255;
      }
      ctx.putImageData(image, 0, 0);
      this.stadiumSprite = canvas;
      this.stadiumHash = hash;
      this.stadiumMeta = { source: 'nes-framebuffer', rect, frame: state.raw?.frame ?? null };
      return canvas;
    }

    _key(player) {
      return String(player.team) + ':' + String(player.positionIndex ?? player.id);
    }

    _class(player) {
      const collision = player.collisionStatus ?? 0;
      const pose = (collision & 0x10) ? 'ground' : (collision & 8) ? 'airborne' : (player.moving || ((player.movementStatus ?? 0) & 0x80)) ? 'moving' : 'standing';
      const facing = Number.isFinite(player.nativeDirection) ? Math.round((player.nativeDirection & 255) / 32) % 8 : null;
      const skin = Number.isInteger(player.face) ? (player.face & 0x80 ? 1 : 0) : Number.isInteger(player.skinPalette) ? player.skinPalette & 1 : null;
      return { pose, facing, skin };
    }

    _teamImage(player) {
      const target = this._class(player);
      if (target.skin === null || target.facing === null) return null;
      for (const record of this.cache.values()) {
        const context = record.context;
        if (!record.last || !context || context.team !== player.team) continue;
        if (context.pose !== target.pose || context.facing !== target.facing || context.skin !== target.skin) continue;
        // The NES has two palettes per native team: matching helmet/jersey
        // colors plus light/dark skin selected by the verified face byte.
        // Never reuse a capture with a different native palette family.
        const expectedPalette = (player.team === 1 ? 2 : 0) + target.skin;
        if (!context.paletteIds.every(palette => palette === expectedPalette)) continue;
        return { image: record.last, from: { team: context.team, positionIndex: context.positionIndex, pose: context.pose, facing: context.facing, skinPalette: context.skin } };
      }
      return null;
    }

    _foot(player, height) {
      const x = Number.isFinite(player.screenFootX) ? player.screenFootX : player.screenX + 8;
      const y = Number.isFinite(player.screenFootY) ? player.screenFootY : player.screenY + height;
      return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
    }

    _sprite(ppu, offset) {
      const oam = ppu.spriteMem;
      if (!oam || offset < 0 || offset + 3 >= oam.length || offset % 4 !== 0) return null;
      const x = oam[offset + 3], y = oam[offset] + 1;
      const tile = oam[offset + 1], attributes = oam[offset + 2];
      const height = ppu.f_spriteSize ? 16 : 8;
      // Keep complete frames only. Hidden/flickered or edge-clipped players
      // retain their last decoded image rather than accumulating partial art.
      if (y >= 240 || y + height > 240 || x + 8 > 256) return null;
      const pixels = new Uint8ClampedArray(8 * height * 4);
      const horizontal = (attributes & 0x40) !== 0;
      const vertical = (attributes & 0x80) !== 0;
      const palette = (attributes & 3) << 2;
      let opaque = 0, hash = 2166136261;
      for (let row = 0; row < height; row++) {
        const sourceRow = vertical ? height - 1 - row : row;
        // NES 8x16 addressing: tile bit zero selects the pattern-table bank;
        // the remaining bits select an even top tile and its following tile.
        const tileIndex = height === 16
          ? (tile & 0xfe) + ((tile & 1) ? 256 : 0) + (sourceRow >> 3)
          : tile + (ppu.f_spPatternTable ? 256 : 0);
        const pattern = ppu.ptTile?.[tileIndex]?.pix;
        if (!pattern || pattern.length < 64) return null;
        for (let column = 0; column < 8; column++) {
          const sourceColumn = horizontal ? 7 - column : column;
          const colorIndex = pattern[(sourceRow & 7) * 8 + sourceColumn] & 3;
          hash = Math.imul(hash ^ colorIndex, 16777619);
          if (colorIndex === 0) continue;
          const color = ppu.sprPalette?.[palette + colorIndex];
          if (!Number.isFinite(color)) return null;
          const dest = (row * 8 + column) * 4;
          // JSNES's framebuffer/sprite palette is BGR: its browser renderer
          // writes 0xff000000 | color to a little-endian canvas ABGR buffer.
          pixels[dest] = color & 255;
          pixels[dest + 1] = (color >>> 8) & 255;
          pixels[dest + 2] = (color >>> 16) & 255;
          pixels[dest + 3] = 255;
          opaque++;
          hash = Math.imul(hash ^ color, 16777619);
        }
      }
      return { offset, x, y, width: 8, height, tile, attributes, pixels, opaque, hash: hash >>> 0 };
    }

    _pair(ppu, offset) {
      const left = this._sprite(ppu, offset);
      const right = this._sprite(ppu, offset + 4);
      if (!left || !right || Math.abs(left.y - right.y) > 1 || Math.abs(left.x - right.x) !== 8) return null;
      if (left.opaque + right.opaque === 0) return null;
      return {
        offset, sprites: [left, right],
        footX: (Math.min(left.x, right.x) + Math.max(left.x, right.x) + 8) / 2,
        footY: Math.max(left.y + left.height, right.y + right.height)
      };
    }

    _extra(ppu, player, group) {
      if (!extraOffset(player.extraSpriteIndex)) return;
      const extra = this._pair(ppu, player.extraSpriteIndex);
      if (!extra) return;
      const nearby = Math.abs(extra.footX - group.footX) <= 24 && Math.abs(extra.footY - group.footY) <= 16;
      if (nearby) group.sprites.push(...extra.sprites);
    }

    _image(group, foot) {
      const sprites = group.sprites;
      const minX = Math.min(...sprites.map(sprite => sprite.x));
      const minY = Math.min(...sprites.map(sprite => sprite.y));
      const width = Math.max(...sprites.map(sprite => sprite.x + sprite.width)) - minX;
      const height = Math.max(...sprites.map(sprite => sprite.y + sprite.height)) - minY;
      if (width > 48 || height > 40) return null;
      const canvas = root.document?.createElement('canvas') || (root.OffscreenCanvas ? new root.OffscreenCanvas(width, height) : null);
      if (!canvas) return null;
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.imageSmoothingEnabled = false;
      const image = ctx.createImageData(width, height);
      // Lower OAM indices win sprite-over-sprite priority. Zero palette indices
      // remain transparent and never erase an opaque pixel from another tile.
      for (const sprite of [...sprites].sort((a, b) => b.offset - a.offset)) {
        for (let y = 0; y < sprite.height; y++) for (let x = 0; x < 8; x++) {
          const src = (y * 8 + x) * 4;
          if (sprite.pixels[src + 3] === 0) continue;
          const dest = ((sprite.y - minY + y) * width + sprite.x - minX + x) * 4;
          image.data.set(sprite.pixels.subarray(src, src + 4), dest);
        }
      }
      ctx.putImageData(image, 0, 0);
      return { canvas, meta: { source: 'nes-oam', width, height, anchorX: foot.x - minX, anchorY: foot.y - minY,
        oamOffsets: sprites.map(sprite => sprite.offset), paletteIds: [...new Set(sprites.map(sprite => sprite.attributes & 3))] } };
    }

    _assign(player, group, foot) {
      const key = this._key(player);
      let record = this.cache.get(key);
      if (!record) { record = { frames: new Map(), last: null }; this.cache.set(key, record); }
      const originX = Math.min(...group.sprites.map(sprite => sprite.x));
      const originY = Math.min(...group.sprites.map(sprite => sprite.y));
      const signature = group.sprites.map(sprite => [sprite.tile, sprite.attributes, sprite.height, sprite.x - originX, sprite.y - originY, sprite.hash].join(',')).join(';');
      let image = record.frames.get(signature);
      if (!image) {
        image = this._image(group, foot);
        if (!image) return false;
        if (record.frames.size >= MAX_ANIMATION_FRAMES) record.frames.delete(record.frames.keys().next().value);
        record.frames.set(signature, image);
      }
      record.last = image;
      const playerClass = this._class(player);
      record.context = { ...playerClass, skin: group.sprites[0].attributes & 1,
        team: player.team, positionIndex: player.positionIndex ?? player.id,
        paletteIds: [...new Set(group.sprites.map(sprite => sprite.attributes & 3))] };
      player.nativeSprite = image.canvas;
      player.nativeSpriteMeta = { ...image.meta, cached: false };
      player.nativeSpriteCached = false;
      player.nativeSpriteReused = false;
      return true;
    }

    capture(nes, state) {
      this.availableCount = 0;
      this.matchedCount = 0;
      this.reusedCount = 0;
      const players = state?.players || [];
      const teamSignature = [state?.humanTeam?.abbr ?? '', state?.cpuTeam?.abbr ?? ''].join(':');
      if (nes !== this.nes || teamSignature !== this.teamSignature) {
        this.clear(); this.nes = nes; this.teamSignature = teamSignature;
      }
      this.state = state;
      const ppu = nes?.ppu;
      const valid = ppu?.spriteMem && ppu?.ptTile && ppu?.sprPalette && ppu.f_spVisibility !== 0;
      const height = ppu?.f_spriteSize ? 16 : 8;
      const used = new Set(), matched = new Set();
      if (valid) {
        // Tecmo's player record +$0C is a byte offset into OAM. The flicker
        // routine swaps two-sprite blocks and updates this exact association.
        for (const player of players) {
          if (!normalOffset(player.spriteIndex) || used.has(player.spriteIndex)) continue;
          const foot = this._foot(player, height);
          const group = this._pair(ppu, player.spriteIndex);
          if (!foot || !group || Math.hypot(group.footX - foot.x, group.footY - foot.y) > MATCH_RADIUS) continue;
          this._extra(ppu, player, group);
          if (this._assign(player, group, foot)) { used.add(group.offset); matched.add(player); this.matchedCount++; }
        }
        // Older/partial state readers may omit the OAM index. Match remaining
        // normal player pairs by screen foot, globally closest first. A hidden
        // player's known OAM slot is never replaced with a nearby player's art.
        const candidates = [];
        for (let offset = FIELD_OAM_START; offset <= FIELD_OAM_END; offset += 8) {
          if (used.has(offset)) continue;
          const group = this._pair(ppu, offset);
          if (!group) continue;
          for (const player of players) {
            if (matched.has(player) || normalOffset(player.spriteIndex)) continue;
            const foot = this._foot(player, height);
            if (!foot) continue;
            const distance = Math.hypot(group.footX - foot.x, group.footY - foot.y);
            if (distance <= MATCH_RADIUS) candidates.push({ player, group, foot, distance });
          }
        }
        candidates.sort((a, b) => a.distance - b.distance);
        for (const candidate of candidates) {
          if (used.has(candidate.group.offset) || matched.has(candidate.player)) continue;
          this._extra(ppu, candidate.player, candidate.group);
          if (this._assign(candidate.player, candidate.group, candidate.foot)) {
            used.add(candidate.group.offset); matched.add(candidate.player); this.matchedCount++;
          }
        }
      }
      for (const player of players) {
        if (!matched.has(player)) {
          const own = this.cache.get(this._key(player))?.last;
          const reused = own ? null : this._teamImage(player);
          const image = own || reused?.image;
          player.nativeSprite = image?.canvas || null;
          player.nativeSpriteCached = Boolean(image);
          player.nativeSpriteReused = Boolean(reused);
          player.nativeSpriteMeta = image ? { ...image.meta, cached: true, ...(reused ? { reusedFrom: reused.from } : {}) } : null;
          if (reused) this.reusedCount++;
        }
        if (player.nativeSprite) this.availableCount++;
      }
      return this.matchedCount;
    }
  }

  root.TecmoNesSprites = TecmoNesSprites;
  if (typeof module !== 'undefined' && module.exports) module.exports = { TecmoNesSprites };
})(globalThis);


;/* src/football-camera.js */
/* Presentation camera only. This controller never changes NES game state. */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const angle = value => ((value + Math.PI) % TAU + TAU) % TAU - Math.PI;
  const valid = point => point && point.valid !== false && Number.isFinite(point.x) && Number.isFinite(point.z) && Math.abs(point.x) < 80 && point.z > -40 && point.z < 140;
  const kickKind = kind => ['kickoff', 'punt', 'fieldgoal', 'extrapoint'].includes(kind);
  // Leave room for the chase outside the painted field, inside the stands.
  const BOUNDS = Object.freeze({ x: 35.5, zMin: -18.5, zMax: 118.5 });
  // The pitch and lens are paired: a 1.9-yard player occupies about 40–55
  // pixels, with his feet near row 208 in the 384×240 presentation. The extra
  // tilt leaves sky and stadium visible below the original NES HUD.
  const PROFILES = Object.freeze({
    presnap: { back: 8.4, side: 0.75, height: 5, horizon: 80, focal: 214, ahead: 10 },
    pocket: { back: 8.8, side: 0.85, height: 5.2, horizon: 80, focal: 214, ahead: 14 },
    runner: { back: 7.8, side: 0.55, height: 4.7, horizon: 80, focal: 212, ahead: 8 },
    defense: { back: 8.2, side: 0.65, height: 4.9, horizon: 80, focal: 212, ahead: 11 },
    'kick-setup': { back: 9.2, side: 0.65, height: 5.6, horizon: 77, focal: 210, ahead: 16 },
    'kick-flight': { back: 10.2, side: 0.25, height: 5.2, horizon: 92, focal: 194, ahead: 5 },
    'pass-flight': { back: 9.4, side: 0.3, height: 4.8, horizon: 88, focal: 200, ahead: 6 },
    loose: { back: 7.8, side: 0.4, height: 4.7, horizon: 80, focal: 212, ahead: 4 },
    dead: { back: 8.4, side: 0.65, height: 5, horizon: 80, focal: 214, ahead: 7 }
  });

  class TecmoFootballCamera {
    constructor(options = {}) {
      this.options = { mode: 'player', ...options };
      this.reset();
    }

    reset() {
      this.ready = false;
      this.lookYaw = 0;
      this.baseYaw = 0;
      this.previousBall = null;
      this.lastPlayerId = null;
      this.playerGrace = 0;
      this.lastMode = 'presnap';
      this.current = { x: 0, z: 20, height: 5, horizon: 80, focal: 214, yaw: 0, mode: 'presnap', player: null, focus: null, aim: null, showPlayer: true, label: 'PLAYER FOLLOW', targetId: null };
      return this;
    }

    _defaultYaw(player, game) {
      return player && Number.isFinite(player.team) && player.team !== (game.possession ?? 0) ? Math.PI : 0;
    }

    _playerYaw(player, game, mode, ball) {
      const baseline = this._defaultYaw(player, game);
      if (mode === 'pocket' || mode === 'presnap') return baseline;
      if (mode === 'defense' && valid(ball) && Math.hypot(ball.x - player.x, ball.z - player.z) > 2.5) return Math.atan2(ball.x - player.x, ball.z - player.z);
      if (mode === 'runner') {
        // WASD is relative to the displayed yaw. Following that same movement
        // angle in full would feed a manual look offset back into itself and
        // keep turning. Retain the drive/return baseline with a bounded lead.
        if (Number.isFinite(player.vx) && Number.isFinite(player.vz)) {
          const lateral = player.vx * Math.cos(baseline) - player.vz * Math.sin(baseline);
          const forward = player.vx * Math.sin(baseline) + player.vz * Math.cos(baseline);
          return baseline + clamp(Math.atan2(lateral, Math.max(2, Math.abs(forward))), -0.18, 0.18);
        }
        return baseline;
      }
      if (Number.isFinite(player.vx) && Number.isFinite(player.vz) && Math.hypot(player.vx, player.vz) > 0.6) return Math.atan2(player.vx, player.vz);
      if (Number.isFinite(player.heading)) return player.heading;
      return baseline;
    }

    _select(game, dt) {
      const players = game.players || [];
      const controlled = valid(game.controlled) ? game.controlled : players.find(player => player.team === 0 && valid(player));
      const ball = valid(game.ball) ? game.ball : null;
      const carrier = valid(game.carrier) ? game.carrier : players.find(player => valid(player) && player.hasBall);
      const kind = game.play?.kind || game.play?.type || 'run';
      const raw = game.raw || {};
      const caught = !!((raw.ballStatus || 0) & 0xa8) || !!((raw.ballSpecialStatus || 0) & 0x20);
      const grounded = carrier && carrier.hasBall !== false && (!ball?.flight || caught);
      const quarterback = players.find(player => player.team === (game.possession ?? 0) && player.role === 'QB' && valid(player));
      const defense = controlled && Number.isFinite(controlled.team) && ((grounded && carrier.team !== controlled.team) || (!grounded && controlled.team !== (game.possession ?? 0)));
      let player = null, focus = null, mode = 'loose';

      // Punt setup can have a flight bit before the punt actually starts. The
      // original presnap phase outranks that bit and keeps the player in view.
      if (game.phase === 'presnap' || game.phase === 'playcall') {
        player = kickKind(kind) ? controlled || carrier || quarterback : defense ? controlled : quarterback || controlled || carrier;
        focus = player || ball;
        mode = kickKind(kind) ? 'kick-setup' : defense ? 'defense' : 'presnap';
      } else if (grounded) {
        player = defense ? controlled : carrier;
        focus = player;
        mode = defense ? 'defense' : player?.role === 'QB' && kind === 'pass' ? 'pocket' : 'runner';
      } else if (ball?.flight) {
        const nearSnap = !kickKind(kind) && quarterback && Math.hypot(ball.x - quarterback.x, ball.z - quarterback.z) < 3.6 && (ball.y ?? 1.35) < 2.1 && !caught;
        if (nearSnap) {
          player = defense ? controlled : quarterback;
          focus = player;
          mode = defense ? 'defense' : 'pocket';
        } else {
          focus = ball;
          mode = kickKind(kind) ? 'kick-flight' : 'pass-flight';
        }
      } else {
        // A one-frame missing carrier during a handoff must not insert a
        // loose-ball shot between two player-follow frames.
        const previous = players.find(candidate => candidate.id === this.lastPlayerId && valid(candidate));
        const grace = previous && this.playerGrace < 0.12 && ball && Math.hypot(ball.x - previous.x, ball.z - previous.z) < 2.8;
        if (grace) {
          player = previous; focus = player; mode = this.lastMode;
          this.playerGrace += dt;
        } else if (defense && controlled) {
          player = controlled; focus = controlled; mode = 'defense';
        } else {
          focus = ball || controlled || quarterback;
          player = focus === ball ? null : focus;
          mode = player ? 'runner' : 'loose';
        }
      }
      if (game.phase === 'dead' || game.phase === 'final') {
        player = defense ? controlled : carrier || player || controlled || quarterback;
        focus = player || ball;
        mode = 'dead';
      }
      if (!valid(focus)) {
        focus = { x: 0, z: Number.isFinite(game.los) ? game.los - 4 : 20, y: 1.35 };
        player = null; mode = 'presnap';
      }
      if (grounded) this.playerGrace = 0;
      return { player, focus, mode, ball, carrier, kind, controlled };
    }

    _widenForAction(profile, game, selected) {
      const { player, ball, mode } = selected;
      if (!player) return;
      if (mode === 'pocket' || mode === 'presnap') {
        const baseline = this._defaultYaw(player, game);
        const sin = Math.sin(baseline), cos = Math.cos(baseline);
        let width = 0, ahead = 0;
        for (const candidate of game.players || []) {
          // Offensive routes determine this zoom. Distant offscreen defenders
          // and players from the prior play cannot pull the pocket shot out.
          if (!valid(candidate) || candidate.team !== player.team || !['WR', 'TE', 'RB'].includes(candidate.role)) continue;
          const dx = candidate.x - player.x, dz = candidate.z - player.z;
          const forward = dx * sin + dz * cos, lateral = Math.abs(dx * cos - dz * sin);
          if (forward < -4 || forward > 38 || lateral > 30) continue;
          width = Math.max(width, lateral); ahead = Math.max(ahead, forward);
        }
        const expansion = Math.max(clamp((width - 10) / 15, 0, 1), clamp((ahead - 15) / 23, 0, 1) * 0.8);
        profile.back += expansion * 1.5;
        profile.height += expansion * 0.95;
        profile.focal -= expansion * 5;
        profile.ahead += expansion * 4;
      } else if (mode === 'defense' && valid(ball)) {
        // Keep the selected defender in the shot while giving him a useful
        // view of the ball carrier farther downfield.
        const expansion = clamp((Math.hypot(ball.x - player.x, ball.z - player.z) - 10) / 20, 0, 1);
        profile.back += expansion * 1.25;
        profile.height += expansion * 0.8;
        profile.focal -= expansion * 6;
        profile.ahead += expansion * 5;
      }
    }

    update(game = {}, dt = 1 / 60, options = {}) {
      const seconds = Number.isFinite(dt) ? clamp(dt, 0, 0.25) : 1 / 60;
      if (Number.isFinite(options.lookYaw)) this.lookYaw = options.lookYaw;
      const helmet = (options.mode || this.options.mode) === 'helmet';
      const selected = this._select(game, seconds);
      const { player, focus, mode, ball, kind, controlled } = selected;
      const flying = mode === 'kick-flight' || mode === 'pass-flight';
      const profile = { ...PROFILES[mode] };
      this._widenForAction(profile, game, selected);
      let desiredYaw = player ? this._playerYaw(player, game, mode, ball) : this.baseYaw;
      if (flying) {
        const previous = this.previousBall;
        const deltaX = previous ? ball.x - previous.x : 0, deltaZ = previous ? ball.z - previous.z : 0;
        const distance = Math.hypot(deltaX, deltaZ);
        // Reject menu/drive teleports. A real horizontal flight gives a stable
        // travel heading; nearly stationary apex frames retain that heading.
        if (seconds > 0 && distance > seconds * 0.8 && distance < 8) desiredYaw = Math.atan2(deltaX, deltaZ);
        else if (!this.ready || !['kick-flight', 'pass-flight'].includes(this.lastMode)) {
          const kicker = (game.players || []).find(candidate => valid(candidate) && (candidate.role === 'K' || candidate.role === 'P') && (kind !== 'kickoff' || candidate.team !== (game.possession ?? 0)));
          desiredYaw = this._defaultYaw(kickKind(kind) ? kicker || controlled : controlled, game);
        }
        const loft = Number.isFinite(ball.y) ? clamp(ball.y, 0, 80) : 1.35;
        profile.back = clamp(profile.back + loft * 0.38, profile.back, 20);
        profile.height = clamp(profile.height + loft * 0.25, 4.8, 11.6);
        profile.horizon = clamp(91 + (loft - profile.height) * profile.focal / profile.back * 0.72, 78, 168);
      }
      desiredYaw = Number.isFinite(desiredYaw) ? angle(desiredYaw) : 0;
      if (!this.ready) this.baseYaw = desiredYaw;
      else {
        const change = angle(desiredYaw - this.baseYaw) * (1 - Math.exp(-seconds * 7));
        // Catch/return heading reversals turn through the shortest arc over
        // time. They never issue a single-frame 180-degree camera cut.
        this.baseYaw = angle(this.baseYaw + clamp(change, -seconds * 3.3, seconds * 3.3));
      }
      if (helmet && player) { profile.back = 0.16; profile.side = 0.04; profile.height = 1.65; profile.horizon = 85; profile.focal = 228; }
      const sin = Math.sin(this.baseYaw), cos = Math.cos(this.baseYaw);
      const desiredX = clamp(focus.x - sin * profile.back + cos * profile.side, -BOUNDS.x, BOUNDS.x);
      const desiredZ = clamp(focus.z - cos * profile.back - sin * profile.side, BOUNDS.zMin, BOUNDS.zMax);
      const k = this.ready ? 1 - Math.exp(-seconds * (flying ? 9 : 12)) : 1;
      const framingK = this.ready ? 1 - Math.exp(-seconds * 6) : 1;
      const camera = this.current;
      camera.x += (desiredX - camera.x) * k;
      camera.z += (desiredZ - camera.z) * k;
      camera.height += (profile.height - camera.height) * framingK;
      camera.horizon += (profile.horizon - camera.horizon) * framingK;
      camera.focal += (profile.focal - camera.focal) * framingK;
      // Keep a chase shot outside the player's body during curved transitions.
      if (!helmet && player) {
        const dx = camera.x - player.x, dz = camera.z - player.z, distance = Math.hypot(dx, dz);
        if (distance < 2.5) {
          const nx = distance > 0.001 ? dx / distance : -sin;
          const nz = distance > 0.001 ? dz / distance : -cos;
          camera.x = player.x + nx * 2.5; camera.z = player.z + nz * 2.5;
        }
      }
      camera.x = clamp(camera.x, -BOUNDS.x, BOUNDS.x); camera.z = clamp(camera.z, BOUNDS.zMin, BOUNDS.zMax);
      camera.height = clamp(camera.height, 1.45, 12);
      camera.yaw = angle(this.baseYaw + this.lookYaw);
      camera.mode = mode; camera.player = player; camera.focus = focus;
      camera.aim = { x: focus.x + sin * profile.ahead, z: focus.z + cos * profile.ahead, y: flying ? Math.max(1.35, Number.isFinite(ball.y) ? ball.y : 1.35) : 1.35 };
      camera.showPlayer = !!player && !helmet;
      camera.label = helmet && player ? 'HELMET VIEW' : { presnap: 'READY AT THE LINE', pocket: 'QB POCKET', runner: 'RUNNER FOLLOW', defense: 'DEFENDER FOLLOW', 'kick-setup': 'KICK SETUP', 'kick-flight': 'KICK FLIGHT', 'pass-flight': 'PASS FLIGHT', loose: 'LOOSE BALL', dead: 'AFTER THE WHISTLE' }[mode];
      camera.targetId = player ? 'player:' + player.id : flying || focus === ball ? 'football' : 'field';
      this.lastPlayerId = player?.id ?? null; this.lastMode = mode;
      this.previousBall = ball ? { x: ball.x, z: ball.z } : null;
      this.ready = true;
      return { ...camera, aim: { ...camera.aim } };
    }
  }
  TecmoFootballCamera.PROFILES = PROFILES;
  root.TecmoFootballCamera = TecmoFootballCamera;
  if (typeof module !== 'undefined' && module.exports) module.exports = { TecmoFootballCamera };
})(globalThis);


;/* src/renderer.js */
(function () {
  'use strict';
  const GLYPHS = {
    A:['01110','10001','10001','11111','10001','10001','10001'],B:['11110','10001','10001','11110','10001','10001','11110'],C:['01111','10000','10000','10000','10000','10000','01111'],D:['11110','10001','10001','10001','10001','10001','11110'],E:['11111','10000','10000','11110','10000','10000','11111'],F:['11111','10000','10000','11110','10000','10000','10000'],G:['01111','10000','10000','10111','10001','10001','01111'],H:['10001','10001','10001','11111','10001','10001','10001'],I:['111','010','010','010','010','010','111'],J:['00111','00010','00010','00010','00010','10010','01100'],K:['10001','10010','10100','11000','10100','10010','10001'],L:['10000','10000','10000','10000','10000','10000','11111'],M:['10001','11011','10101','10101','10001','10001','10001'],N:['10001','11001','10101','10011','10001','10001','10001'],O:['01110','10001','10001','10001','10001','10001','01110'],P:['11110','10001','10001','11110','10000','10000','10000'],Q:['01110','10001','10001','10001','10101','10010','01101'],R:['11110','10001','10001','11110','10100','10010','10001'],S:['01111','10000','10000','01110','00001','00001','11110'],T:['11111','00100','00100','00100','00100','00100','00100'],U:['10001','10001','10001','10001','10001','10001','01110'],V:['10001','10001','10001','10001','10001','01010','00100'],W:['10001','10001','10001','10101','10101','10101','01010'],X:['10001','10001','01010','00100','01010','10001','10001'],Y:['10001','10001','01010','00100','00100','00100','00100'],Z:['11111','00001','00010','00100','01000','10000','11111'],
    '0':['01110','10001','10011','10101','11001','10001','01110'],'1':['010','110','010','010','010','010','111'],'2':['01110','10001','00001','00010','00100','01000','11111'],'3':['11110','00001','00001','01110','00001','00001','11110'],'4':['00010','00110','01010','10010','11111','00010','00010'],'5':['11111','10000','10000','11110','00001','00001','11110'],'6':['01110','10000','10000','11110','10001','10001','01110'],'7':['11111','00001','00010','00100','01000','01000','01000'],'8':['01110','10001','10001','01110','10001','10001','01110'],'9':['01110','10001','10001','01111','00001','00001','01110'],':':['0','1','0','0','1','0','0'],'-':['000','000','000','111','000','000','000'],'!':['1','1','1','1','1','0','1'],'.':['0','0','0','0','0','0','1'],'/':['00001','00001','00010','00100','01000','10000','10000'],'>':['100','010','001','001','001','010','100']
  };
  function pixelText(ctx, text, x, y, size = 1, color = '#fff', align = 'left') {
    text = String(text).toUpperCase();
    const width = [...text].reduce((s,ch)=>s + (GLYPHS[ch]?.[0].length ?? 3) + 1,0)*size;
    if (align === 'center') x -= width / 2;
    if (align === 'right') x -= width;
    ctx.fillStyle=color;
    for (const ch of text) {
      const pattern=GLYPHS[ch];
      if (pattern) pattern.forEach((row, j)=>[...row].forEach((v,i)=>{if(v==='1')ctx.fillRect(Math.round(x+i*size),Math.round(y+j*size),size,size);}));
      x += ((pattern?.[0].length ?? 3)+1)*size;
    }
    return width;
  }
  const rgb = hex => { hex=hex.replace('#',''); return [parseInt(hex.slice(0,2),16),parseInt(hex.slice(2,4),16),parseInt(hex.slice(4,6),16)]; };
  class FieldRenderer {
    constructor(canvas, minimap) {
      this.canvas=canvas;this.ctx=canvas.getContext('2d',{alpha:false});this.ctx.imageSmoothingEnabled=false;
      this.map=minimap;this.mapCtx=minimap?.getContext('2d');this.width=384;this.height=240;canvas.width=this.width;canvas.height=this.height;
      this.frame=this.ctx.createImageData(this.width,this.height);this.spriteCache=new Map();this.time=0;this.yaw=0;this.camera={x:0,z:20};this.lastControlled=null;this.cameraPlayer=null;this.cameraFocus=null;this.cameraMode='player';this.cameraHeight=2.5;
      this.footballCamera=typeof TecmoFootballCamera==='function'?new TecmoFootballCamera():null;
      this.cameraShot=null;
    }
    project(x,y,z) {
      const dx=x-this.camera.x,dz=z-this.camera.z;
      const depth=dx*this.sin+dz*this.cos;
      if(depth < 0.15)return null;
      return {x:this.width/2+(dx*this.cos-dz*this.sin)*this.focal/depth,y:this.horizon+(this.eye-y)*this.focal/depth,d:depth,s:this.focal/depth};
    }
    rectWorld(x,z,w,h,color) {
      const a=this.project(x,0,z),b=this.project(x+w,0,z),c=this.project(x+w,0,z+h),d=this.project(x,0,z+h);
      if(!a||!b||!c||!d)return;
      this.ctx.fillStyle=color;this.ctx.beginPath();this.ctx.moveTo(a.x,a.y);this.ctx.lineTo(b.x,b.y);this.ctx.lineTo(c.x,c.y);this.ctx.lineTo(d.x,d.y);this.ctx.closePath();this.ctx.fill();
    }
    groundText(text,x,z,size,color) {
      for(const ch of String(text)){const pat=GLYPHS[ch];if(pat)pat.forEach((row,j)=>[...row].forEach((v,i)=>{if(v==='1')this.rectWorld(x+i*size,z+(6-j)*size,size*.95,size*.95,color);}));x+=((pat?.[0].length||3)+1)*size;}
    }
    resetCamera() {
      this.footballCamera?.reset();this.lastControlled=null;this.cameraShot=null;
    }
    followBall(game,dt,options={}) {
      if(!this.footballCamera)return null;
      const shot=this.footballCamera.update(game,dt,{lookYaw:options.lookYaw??options.yaw??0,mode:options.cameraView??'player'});
      this.cameraShot=shot;this.camera.x=shot.x;this.camera.z=shot.z;this.yaw=shot.yaw;
      this.cameraPlayer=shot.player;this.cameraFocus=shot.focus;this.cameraMode=shot.mode;this.cameraHeight=shot.height;this.lastControlled='football';
      return shot.focus;
    }
    render(game,dt,options={}) {
      const ctx=this.ctx,w=this.width,h=this.height;this.time+=dt;
      let p=game?.controlled;
      const preview=options.preview;
      if(game?.authentic&&!preview){this.followBall(game,dt,options);p=this.cameraShot?.showPlayer?null:this.cameraPlayer;}
      else if(p&&!preview){if(this.lastControlled!==p.id){this.camera.x=p.x;this.camera.z=p.z;this.lastControlled=p.id;}const k=1-Math.exp(-dt*16);this.camera.x+=(p.x-this.camera.x)*k;this.camera.z+=(p.z-this.camera.z)*k;this.cameraHeight=1.65;}
      else {this.camera.x=Math.sin(this.time*.12)*1.2;this.camera.z=(game?.los??25)-5;}
      if(!game?.authentic||preview)this.yaw=options.yaw??0;
      this.sin=Math.sin(this.yaw);this.cos=Math.cos(this.yaw);this.focal=game?.authentic?this.cameraShot?.focal??228:228;
      const moving=options.moving&&game?.phase==='live';const bob=moving?Math.sin(this.time*(options.sprint?15:10))*.025:0;
      this.eye=(game?.authentic?this.cameraHeight:1.65)+bob;this.horizon=(game?.authentic?this.cameraShot?.horizon??85:85)+Math.sin(this.time*.8)*.2;
      if(game?.authentic)this.drawNativeStadium(game);else this.drawStadium(game);
      const data=this.frame.data;const start=Math.floor(this.horizon+1);const goal=game?.los+game?.toGo;
      const atlas=game?.authentic?game.fieldAtlas:null,fieldPixels=atlas?.data;
      const hasNativeField=!!(fieldPixels&&atlas.width>0&&atlas.height>0&&fieldPixels.length===atlas.width*atlas.height*4);
      const fieldDirection=game?.direction<0?-1:1;
      const attacking=game?.possession===1?game?.cpuTeam:game?.humanTeam,defending=game?.possession===1?game?.humanTeam:game?.cpuTeam;const endA=rgb(attacking?.primary||'#205bc3'),endB=rgb(defending?.primary||'#b52b42');const turf=game?.fieldPalette?.turf,marking=game?.fieldPalette?.marking||[218,231,196];
      for(let sy=start;sy<h;sy++){
        const depth=this.eye*this.focal/(sy-this.horizon);const scale=depth/this.focal;
        for(let sx=0;sx<w;sx++){
          const side=(sx-w/2)*scale;const x=this.camera.x+this.sin*depth+this.cos*side;const z=this.camera.z+this.cos*depth-this.sin*side;
          let c,fieldOffset=-1;
          if(Math.abs(x)>27.3||z < -10||z>110){if(game?.authentic){const ax=Math.abs(x),box=z>=30&&z<=70;c=box&&(Math.abs(ax-28.6)<.1||Math.abs(ax-29.4)<.1)?[236,238,236]:box&&ax>29.6&&ax<34?[108,84,44]:turf?[turf[0]*.7|0,turf[1]*.7|0,turf[2]*.7|0]:[24,92,52];}else c=((Math.floor(x+z)*3)&1)?[31,48,64]:[36,55,72];}
          else if(Math.abs(x)>26.4)c=[227,237,219];
          else if(z<0||z>100){const base=z<0?endA:endB; c=base.map(v=>Math.floor(v*(Math.floor(x+z)%2===0?0.7:0.85)));}
          else{
            const band=Math.floor(z/5)%2===0;
            c=turf|| (band?[39,126,77]:[33,116,66]);
            const grain=(Math.floor(x*2)+Math.floor(z*2))&3;if(grain===0&&!game?.authentic)c=[c[0]+3,c[1]+5,c[2]+3];
            const lineDistance=Math.abs(z-Math.round(z/5)*5);
            const lineWidth=Math.max(.09,depth/850);
            if(lineDistance<lineWidth)c=marking;
            else if(Math.abs(z-Math.round(z))<.075&&(Math.abs(Math.abs(x)-3.1)<.35||Math.abs(x)>25.7))c=game?.authentic?marking:[184,214,171];
            if(game&&!game.authentic&&Math.abs(z-game.los)<Math.max(.07,depth/1000))c=[77,222,231];
            if(game&&!game.authentic&&Math.abs(z-goal)<Math.max(.09,depth/900)&&goal<100)c=[253,188,66];
          }
          if(hasNativeField){
            const nativeX=fieldDirection>0?1648+z*8:2448-z*8,nativeY=120+x*(160/53.3)*fieldDirection;
            const tx=Math.floor(nativeX-(atlas.nativeLeftX??1536)),ty=Math.floor(nativeY-(atlas.nativeTopY??40));
            if(tx>=0&&tx<atlas.width&&ty>=0&&ty<atlas.height)fieldOffset=(ty*atlas.width+tx)*4;
          }
          if(game?.authentic&&options.fieldGuides!==false&&['run','pass'].includes(game.play?.kind)&&['live','presnap'].includes(game.phase)&&Math.abs(x)<26.4&&z>=0&&z<=100){
            const lineWidth=Math.max(.075,depth/900);
            if(Math.abs(z-game.los)<lineWidth){c=[0,168,248];fieldOffset=-1;}
            else if(goal<100&&Math.abs(z-goal)<lineWidth){c=[248,216,0];fieldOffset=-1;}
          }
          const offset=(sy*w+sx)*4;data[offset]=fieldOffset>=0?fieldPixels[fieldOffset]:c[0];data[offset+1]=fieldOffset>=0?fieldPixels[fieldOffset+1]:c[1];data[offset+2]=fieldOffset>=0?fieldPixels[fieldOffset+2]:c[2];data[offset+3]=255;
        }
      }
      ctx.putImageData(this.frame,0,0,0,start,w,h-start);
      if(game?.authentic)this.drawNativeStands(game,dt);
      if(!hasNativeField){
        for(let z=10;z<100;z+=10){const n=z<=50?z:100-z;this.groundText(n,-23,z-1.3,.26,'#c0d6ad');this.groundText(n,19.5,z-1.3,.26,'#c0d6ad');}
        this.groundText(defending?.abbr||'AWAY',-7,103,.45,'#e2d8d6');this.groundText(attacking?.abbr||'HOME',-7,-7,.45,'#e2d8d6');
      }
      this.drawGoal(0,110);this.drawGoal(0,-10);
      if(game){
        const players=game.players.filter(q=>!p||q.id!==p.id).map(q=>({p:q,screen:this.project(q.x,0,q.z)})).filter(v=>v.screen&&v.screen.d<110).sort((a,b)=>b.screen.d-a.screen.d);
        for(const obj of players)this.drawPlayer(obj.p,obj.screen,game);
        if(game.ball?.flight&&(!game.authentic||['kick-flight','pass-flight'].includes(this.cameraMode))){const b=game.ball,s=this.project(b.x,b.y??2,b.z);if(s){const size=Math.max(3,Math.min(15,s.s*.3));ctx.fillStyle='#563227';ctx.fillRect(s.x-size/2,s.y-size/3,size,size*.66);ctx.fillStyle='#d6a85a';ctx.fillRect(s.x-size/2+1,s.y-size/3+1,size-2,Math.max(1,size*.25));ctx.fillStyle='#fff1c5';ctx.fillRect(s.x-1,s.y-1,2,2);}}
        if(game.phase==='live'||game.phase==='presnap')this.drawTargets(game);
        this.drawHands(game,moving,bob);
        this.drawMap(game);
        if(game.authentic)this.drawFocusIndicator(game);
      }
      // A restrained CRT mask, rendered into the low-resolution frame.
      ctx.fillStyle='rgba(0,0,0,.055)';for(let y=0;y<h;y+=2)ctx.fillRect(0,y,w,1);
      if(options.damage>0){ctx.fillStyle=`rgba(239,58,76,${Math.min(.25,options.damage*.25)})`;ctx.fillRect(0,0,w,h);}
      if(game?.authentic)this.drawNativeHUD(game);
    }
    drawNativeHUD(game){
      if(!game.nativeHUD)return;
      this.ctx.fillStyle='#000';this.ctx.fillRect(0,0,this.width,48);
      this.ctx.drawImage(game.nativeHUD,0,0,256,32,0,0,this.width,48);
      const kickLabels={kickoff:'KICKOFF',punt:'PUNT',fieldgoal:'FIELD GOAL',extrapoint:'EXTRA POINT'};
      const down=['','1ST','2ND','3RD','4TH'][game.down]||'1ST';
      const situation=kickLabels[game.play?.kind]||`${down} AND ${Math.ceil(game.toGo??10)}`;
      pixelText(this.ctx,`P1 ${game.scores?.[0]??0}  P2 ${game.scores?.[1]??0}`,8,5,1,'#f8f8f8');
      pixelText(this.ctx,`Q${game.quarter??1}  ${situation}`,this.width-8,5,1,'#f8d800','right');
    }
    drawFocusIndicator(game){
      const player=this.cameraShot?.showPlayer?this.cameraPlayer:null;
      const flight=['kick-flight','pass-flight'].includes(this.cameraMode);
      const target=player||(flight?game.ball:null);if(!target)return;
      const s=this.project(target.x,player?2.1:(target.y??2)+.4,target.z);if(!s)return;
      const inside=s.x>=10&&s.x<=this.width-10&&s.y>=55&&s.y<this.height-15;
      const x=Math.round(Math.max(12,Math.min(this.width-12,s.x))),y=Math.round(Math.max(59,Math.min(this.height-21,s.y-12)));
      const c=this.ctx,color=player?'#00e8d8':'#f8d800';
      c.fillStyle='#000';c.fillRect(x-8,y-2,17,7);c.fillRect(x-6,y+5,13,3);c.fillRect(x-4,y+8,9,3);c.fillRect(x-2,y+11,5,3);
      c.fillStyle=color;c.fillRect(x-6,y,13,3);c.fillRect(x-4,y+3,9,3);c.fillRect(x-2,y+6,5,3);c.fillRect(x,y+9,1,2);
      const label=player?(game.controlled?.id===player.id?'1P':'FOCUS'):'BALL';
      pixelText(c,label,x,y-11,1,color,'center');
      if(!inside){c.fillStyle=color;c.fillRect(x-1,y+15,3,3);}
      if(player){const foot=this.project(player.x,.03,player.z);if(foot&&foot.y<this.height-2){c.strokeStyle=color;c.lineWidth=1;c.beginPath();c.ellipse(foot.x,foot.y,Math.max(4,foot.s*.7),Math.max(1.5,foot.s*.16),0,0,Math.PI*2);c.stroke();}}
    }
    skyPhase(game){
      // Kickoff in daylight, dusk in the third quarter, lights-on night for the fourth and overtime.
      const q=game?.quarter??1;return game?.overtime||q>=4?'night':q===3?'dusk':'day';
    }
    makeCanvas(width,height){
      const canvas=globalThis.document?.createElement('canvas')||(globalThis.OffscreenCanvas?new OffscreenCanvas(width,height):null);
      if(!canvas)return null;canvas.width=width;canvas.height=height;return canvas;
    }
    stadiumArt(phase){
      // Small NES-palette textures, built once per sky phase.
      this.artCache=this.artCache||{};if(this.artCache[phase]!==undefined)return this.artCache[phase];
      const lit=phase!=='day',clouds=this.makeCanvas(512,40),facade=this.makeCanvas(32,8),bank=this.makeCanvas(16,8);
      if(!clouds||!facade||!bank)return this.artCache[phase]=null;
      const cc=clouds.getContext('2d'),[cloud,shade]=phase==='day'?['#fcfcfc','#a4e4fc']:phase==='dusk'?['#fce0a8','#fca044']:['#3c3c7c','#24185c'];
      let seed=7;const rand=()=>(seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff;
      for(let i=0;i<9;i++){const x=Math.floor(i*57+rand()*24),y=Math.floor(8+rand()*20),len=24+Math.floor(rand()*30);
        cc.fillStyle=shade;cc.fillRect(x,y+4,len,4);cc.fillStyle=cloud;cc.fillRect(x+4,y,len-8,5);cc.fillRect(x+10,y-3,Math.floor(len/3),3);cc.fillRect(x+Math.floor(len/2),y-2,Math.floor(len/4),2);}
      if(phase==='night')for(let i=0;i<70;i++){cc.fillStyle=i%5?'#bcbcbc':'#fcfcfc';cc.fillRect(Math.floor(rand()*512),Math.floor(rand()*38),1,1);}
      const fc=facade.getContext('2d');fc.fillStyle='#24314b';fc.fillRect(0,0,32,8);fc.fillStyle='#bcc4cf';fc.fillRect(0,0,32,1);fc.fillRect(0,7,32,1);
      fc.fillStyle=lit?'#f8d878':'#526479';for(let x=1;x<32;x+=4)fc.fillRect(x,3,2,2);
      const bc=bank.getContext('2d');bc.fillStyle='#3c3c3c';bc.fillRect(0,0,16,8);bc.fillStyle=lit?'#fcfcfc':'#a4a4a4';for(let y=1;y<8;y+=3)for(let x=1;x<16;x+=3)bc.fillRect(x,y,2,2);
      return this.artCache[phase]={clouds,facade,bank,lit};
    }
    drawNativeStadium(game){
      const c=this.ctx,w=this.width,hz=Math.floor(this.horizon),phase=this.skyPhase(game);
      // Banded NES palette skies, stepping lighter toward the horizon. The bands sit
      // low because the original HUD covers the top 48 rows.
      const sky={day:['#0078f8','#3cbcfc','#a4e4fc'],dusk:['#4428bc','#e45c10','#fca044'],night:['#000000','#00005c','#0000a8']}[phase];
      c.fillStyle=sky[0];c.fillRect(0,0,w,this.height);c.fillStyle=sky[1];c.fillRect(0,hz-22,w,22);c.fillStyle=sky[2];c.fillRect(0,hz-9,w,9);
      const art=this.stadiumArt(phase);
      if(art){const shift=((this.yaw/(Math.PI*2)*1536)%512+512)%512;for(let x=-shift;x<w;x+=512)c.drawImage(art.clouds,Math.floor(x),hz-48);}
      // The stands drawn after the field enclose it on every side, so no backdrop strip is needed here.
    }
    updateCrowd(game,dt){
      // Scoring sets the crowd on its feet for a few seconds.
      const total=(game.scores?.[0]??0)+(game.scores?.[1]??0);
      if(this.crowdScore!=null&&total>this.crowdScore)this.cheer=4;
      this.crowdScore=total;this.cheer=Math.max(0,(this.cheer||0)-dt);
    }
    facing(x,z,width){
      // A flat billboard turned toward midfield; x1 to x2 runs left to right as seen from there.
      const len=Math.hypot(x,z-50)||1,px=(z-50)/len*width/2,pz=-x/len*width/2;
      return {x1:x-px,z1:z-pz,x2:x+px,z2:z+pz,d:Math.hypot(x-this.camera.x,z-this.camera.z)};
    }
    scoreboardTexture(game){
      const home=game.humanTeam?.abbr||'HOME',away=game.cpuTeam?.abbr||'AWAY',clock=game.clock??0;
      const key=[home,away,game.scores?.[0]??0,game.scores?.[1]??0,game.quarter??1,Math.floor(clock/60),clock%60].join(':');
      if(this.boardKey===key&&this.board)return this.board;
      const board=this.board||this.makeCanvas(96,36);if(!board)return null;
      const b=board.getContext('2d');b.fillStyle='#000000';b.fillRect(0,0,96,36);b.fillStyle='#f8d800';b.fillRect(0,0,96,1);b.fillRect(0,35,96,1);b.fillRect(0,0,1,36);b.fillRect(95,0,1,36);
      pixelText(b,`${home} ${game.scores?.[0]??0}`,6,5,1,'#f8f8f8');pixelText(b,`${away} ${game.scores?.[1]??0}`,6,15,1,'#f8f8f8');
      pixelText(b,`Q${game.quarter??1}`,90,5,1,'#f8d800','right');pixelText(b,`${Math.floor(clock/60)}:${String(clock%60).padStart(2,'0')}`,90,15,1,'#fca044','right');
      pixelText(b,'TECMO BOWL',48,26,1,'#3cbcfc','center');
      this.board=board;this.boardKey=key;return board;
    }
    bowl(offset,radius=12){
      // Rounded-rectangle outline of the bowl at a given setback from the first tier.
      const points=[],r=radius+offset,corners=[[36-radius,-19+radius,-Math.PI/2],[36-radius,119-radius,0],[-36+radius,119-radius,Math.PI/2],[-36+radius,-19+radius,Math.PI]];
      for(const [cx,cz,start] of corners)for(let i=0;i<=5;i++){const a=start+i/5*Math.PI/2;points.push([cx+Math.cos(a)*r,cz+Math.sin(a)*r]);}
      return points;
    }
    drawNativeStands(game,dt=0){
      this.updateCrowd(game,dt);
      const panels=[],step=6,phase=this.skyPhase(game),art=this.stadiumArt(phase);
      const home=game.humanTeam?.primary||'#285cc4',away=game.cpuTeam?.primary||'#bc303c';
      const edge=(x1,z1,x2,z2,tier,u0)=>{const length=Math.hypot(x2-x1,z2-z1),n=Math.ceil(length/20);for(let i=0;i<n;i++){const a=i/n,b=(i+1)/n;panels.push({tier,u0:u0+length*a/16,u1:u0+length*b/16,x1:x1+(x2-x1)*a,z1:z1+(z2-z1)*a,x2:x1+(x2-x1)*b,z2:z1+(z2-z1)*b,d:Math.hypot((x1+(x2-x1)*(a+b)/2)-this.camera.x,(z1+(z2-z1)*(a+b)/2)-this.camera.z)});}return length/16;};
      // Each higher tier sits farther back so the bowl rakes away from the field.
      for(let tier=0;tier<3;tier++){const pts=this.bowl(tier*step);let u=0;for(let i=0;i<pts.length;i++){const [x1,z1]=pts[i],[x2,z2]=pts[(i+1)%pts.length];u+=edge(x1,z1,x2,z2,tier,u);}}
      // The upper deck runs along the sidelines only, leaving the ends open to the sky.
      for(let i=panels.length-1;i>=0;i--){const p=panels[i];if(p.tier===2&&Math.abs((p.z1+p.z2)/2-50)>58)panels.splice(i,1);}
      panels.sort((a,b)=>b.tier-a.tier||b.d-a.d);
      // Light towers and end-zone scoreboards stand behind the upper deck.
      const behind=[];
      for(const [x,z] of [[-47,-31],[47,-31],[47,131],[-47,131]])behind.push({kind:'tower',x,z,...this.facing(x,z,8)});
      for(const z of [-40,140])behind.push({kind:'board',x:0,z,...this.facing(0,z,26)});
      behind.sort((a,b)=>b.d-a.d);
      const board=this.scoreboardTexture(game);
      for(const o of behind){
        if(o.kind==='tower'){
          const pole=this.facing(o.x,o.z,.9);this.drawStandPanel(pole,0,16,null,'#7c7c7c');this.drawStandPanel(o,16,19.5,art?.bank,'#bcbcbc');
          if(art?.lit){const s=this.project(o.x,17.75,o.z);if(s){const r=Math.max(3,s.s*6);this.ctx.fillStyle='rgba(252,248,200,.18)';this.ctx.fillRect(s.x-r,s.y-r*.7,r*2,r*1.4);}}
        }else{
          for(const dx of [-9,9]){const leg=this.facing(o.x+dx,o.z,1);this.drawStandPanel(leg,0,13,null,'#526479');}
          this.drawStandPanel(o,13,21,board,'#000000');
        }
      }
      for(const p of panels){
        const base=1.2+p.tier*3.1,mid=((p.x1+p.x2)/2);
        if(p.tier===0){const wall=Math.abs((p.z1+p.z2)/2-50)>62?'#24313b':mid<0?home:away;this.drawStandPanel(p,0,1.05,null,wall);this.drawStandPanel(p,1.05,1.2,null,'#f8f8f8');}
        else{this.drawStandPanel(p,0,base-.3,null,'#1b2531');this.drawStandPanel(p,base-.3,base,null,'#6b7a8c');}
        this.drawStandPanel(p,base,base+2.5,game.stadiumSprite,'#3b4562',true);this.drawStandPanel(p,base+2.5,base+2.7,null,'#526479');
        if(p.tier===2){this.drawStandPanel(p,base+2.7,base+3.9,art?.facade,'#24314b');this.drawStandPanel(p,base+3.9,base+4.1,null,'#bcc4cf');}
      }
      this.drawSideline(game,home,away);
    }
    drawSideline(game,home,away){
      // Team benches behind the coaching boxes on each sideline.
      for(const [x,color] of [[-32,home],[32,away]]){const bench={x1:x,z1:x<0?35:65,x2:x,z2:x<0?65:35};this.drawStandPanel(bench,0,.55,null,'#bcbcbc');this.drawStandPanel(bench,.55,1.1,null,color);}
      const c=this.ctx,marks=[];
      // Orange sideline yard markers every ten yards.
      for(let z=10;z<100;z+=10)for(const x of [-28.4,28.4])marks.push({x,z,label:String(z<=50?z:100-z),color:'#fca044'});
      // The chain crew: down marker at the line of scrimmage, first-down stake at the line to gain.
      const chains=game.play&&['run','pass'].includes(game.play.kind)&&['live','presnap'].includes(game.phase);
      if(chains){marks.push({x:28.9,z:game.los,label:String(game.down??1),color:'#f87858',tall:true});const goal=game.los+game.toGo;if(goal<100)marks.push({x:28.9,z:goal,label:'',color:'#f87858',tall:true});
        const a=this.project(28.9,.05,game.los),b=this.project(28.9,.05,Math.min(100,goal));if(a&&b){c.strokeStyle='#f8d800';c.lineWidth=1;c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();}}
      const shown=marks.map(m=>({m,s:this.project(m.x,0,m.z)})).filter(v=>v.s&&v.s.d<90&&v.s.x>-20&&v.s.x<this.width+20).sort((a,b)=>b.s.d-a.s.d);
      for(const {m,s} of shown){
        const height=s.s*(m.tall?2.4:.9),width=Math.max(1,s.s*(m.tall?.18:.55)),top=s.y-height;
        c.fillStyle=m.color;c.fillRect(Math.round(s.x-width/2),Math.round(top),Math.ceil(width),Math.ceil(height));
        if(m.tall){const flag=Math.max(3,s.s*.6);c.fillRect(Math.round(s.x-flag/2),Math.round(top-flag),Math.ceil(flag),Math.ceil(flag));if(m.label&&flag>=8)pixelText(c,m.label,s.x,top-flag+1,1,'#000000','center');}
        else if(m.label&&width>=12)pixelText(c,m.label,s.x,top+Math.max(1,(height-7)/2),1,'#000000','center');
      }
    }
    drawStandPanel(panel,base,top,texture,color,crowd=false){
      const c=this.ctx,local=(x,z)=>({side:(x-this.camera.x)*this.cos-(z-this.camera.z)*this.sin,depth:(x-this.camera.x)*this.sin+(z-this.camera.z)*this.cos});
      const U0=panel.u0??0,U1=panel.u1??1;
      let a=local(panel.x1,panel.z1),b=local(panel.x2,panel.z2),u1=U0,u2=U1;
      if(a.depth<1&&b.depth<1)return;
      if(a.depth<1){const t=(1-a.depth)/(b.depth-a.depth);a={side:a.side+(b.side-a.side)*t,depth:1};u1=U0+(U1-U0)*t;}
      if(b.depth<1){const t=(1-b.depth)/(a.depth-b.depth);b={side:b.side+(a.side-b.side)*t,depth:1};u2=U1+(u1-U1)*t;}
      let x1=this.width/2+a.side*this.focal/a.depth,x2=this.width/2+b.side*this.focal/b.depth;
      if(x2<x1){[a,b]=[b,a];[u1,u2]=[u2,u1];[x1,x2]=[x2,x1];}
      if(x2<0||x1>this.width||x2-x1<.1)return;
      const cheering=crowd&&texture&&this.cheer>0,tick=Math.floor(this.time*8);
      c.fillStyle=color;
      for(let x=Math.max(0,Math.floor(x1));x<Math.min(this.width,Math.ceil(x2));x++){
        const t=Math.max(0,Math.min(1,(x+.5-x1)/(x2-x1))),inv=(1-t)/a.depth+t/b.depth;
        const yTop=this.horizon+(this.eye-top)*this.focal*inv,yBottom=this.horizon+(this.eye-base)*this.focal*inv;
        const y=Math.max(-this.height,Math.floor(yTop)),height=Math.min(this.height*3,Math.ceil(yBottom-yTop));if(height<=0)continue;
        if(texture){
          const u=((1-t)*u1/a.depth+t*u2/b.depth)/inv,tx=Math.floor((u%1+1)%1*texture.width)%texture.width;
          if(cheering){
            // Fans jump in alternating sections, with the odd camera flash.
            const jump=((tx>>3)+tick)&1?Math.max(1,Math.round(height*.12)):0;
            c.fillRect(x,y,1,height);c.drawImage(texture,tx,0,1,texture.height,x,y-jump,1,height);
            if(((tx*31+tick*17+x)%97)===0){c.fillStyle='#fcfcfc';c.fillRect(x,y+((tx*7+tick)%Math.max(1,height)),1,1);c.fillStyle=color;}
          }else c.drawImage(texture,tx,0,1,texture.height,x,y,1,height);
        }
        else c.fillRect(x,y,1,height);
      }
    }
    drawStadium(game){
      const c=this.ctx,w=this.width;
      c.fillStyle='#151f47';c.fillRect(0,0,w,240);c.fillStyle='#293a68';c.fillRect(0,30,w,42);
      c.fillStyle='#59638c';c.fillRect(24,25,33,5);c.fillRect(32,20,17,5);c.fillRect(285,17,49,5);c.fillRect(298,12,20,5);
      c.fillStyle='#111c34';c.fillRect(0,44,w,40);
      c.fillStyle='#3b4562';c.fillRect(0,48,w,3);c.fillRect(0,57,w,2);c.fillRect(0,66,w,2);c.fillRect(0,75,w,2);
      const crowd=['#9695a5','#a85462','#d9bfa0','#b09f47','#405fa2','#e5d6b0'];
      for(let row=0;row<4;row++)for(let col=0;col<96;col++){c.fillStyle=crowd[(col*7+row*11)%6];c.fillRect(col*4+(row%2)*2,52+row*8,2,2);}
      c.fillStyle='#a2abb1';c.fillRect(0,81,w,4);c.fillStyle='#1a4052';c.fillRect(0,85,w,5);
      for(const x of [17,365]){c.fillStyle='#b3bdc3';c.fillRect(x,16,2,40);c.fillStyle='#e4e7c5';c.fillRect(x-6,10,14,6);c.fillStyle='#4e587e';c.fillRect(x-4,11,2,3);c.fillRect(x+1,11,2,3);}
      const x=153; c.fillStyle='#060e20';c.fillRect(x,33,79,32);c.fillStyle='#526479';c.fillRect(x-2,31,83,2);c.fillRect(x-2,65,83,2);pixelText(c,'HOME FIELD',x+40,37,1,'#9bb0bc','center');
      pixelText(c,game?`${game.scores[0]} - ${game.scores[1]}`:'8 BIT',x+40,51,1,'#ffc55a','center');
    }
    drawGoal(x,z){
      const base=this.project(x,0,z),stem=this.project(x,3,z),a=this.project(x-3,3,z),b=this.project(x+3,3,z),at=this.project(x-3,6,z),bt=this.project(x+3,6,z);if(!base||!stem||!a||!b||!at||!bt)return;
      const c=this.ctx;c.strokeStyle='#efd471';c.lineWidth=Math.max(1,stem.s*.1);c.beginPath();c.moveTo(base.x,base.y);c.lineTo(stem.x,stem.y);c.moveTo(at.x,at.y);c.lineTo(a.x,a.y);c.lineTo(b.x,b.y);c.lineTo(bt.x,bt.y);c.stroke();
    }
    sprite(team,number,back,frame,stunned){
      const primary=team?.primary||'#245bbc',secondary=team?.secondary||'#eef1df';
      const key=`${primary}/${secondary}/${number}/${back}/${frame}/${!!stunned}`;if(this.spriteCache.has(key))return this.spriteCache.get(key);
      const s=document.createElement('canvas');s.width=24;s.height=36;const c=s.getContext('2d');
      const r=(x,y,w,h,color)=>{c.fillStyle=color;c.fillRect(x,y,w,h);};
      const outline='#111d30',skin='#dba17b';r(8,0,8,2,outline);r(5,2,14,8,outline);r(7,1,10,9,secondary);r(5,3,14,5,secondary);r(11,1,2,8,primary);
      if(!back){r(5,7,14,3,outline);r(7,7,10,2,skin);r(8,9,8,2,'#b1b6b1');r(6,8,2,3,'#b1b6b1');r(16,8,2,3,'#b1b6b1');r(9,7,2,1,outline);r(14,7,2,1,outline);}else r(8,8,8,3,primary);
      r(3,12,18,11,outline);r(4,11,16,5,primary);r(6,14,12,9,primary);r(2,13,4,7,primary);r(18,13,4,7,primary);r(2,16,4,2,secondary);r(18,16,4,2,secondary);
      const swing=frame?2:0;r(1,20-swing,4,5,skin);r(19,20+swing,4,4,skin);r(1,24-swing,4,2,secondary);r(19,24+swing,4,2,secondary);
      pixelText(c,String(number%100).padStart(2,'0'),12,15,1,'#efe8d0','center');
      r(6,23,12,5,'#efe8d0');r(6,27,5,5,'#efe8d0');r(13,27,5,5,'#efe8d0');r(7,26,2,5,primary);r(15,26,2,5,primary);
      r(5,31-swing,6,3,skin);r(13,31+swing,6,3,skin);r(4,33-swing,7,3,outline);r(13,33+swing,7,3,outline);
      if(stunned){c.clearRect(0,0,24,36);r(1,27,22,4,primary);r(2,26,5,5,secondary);r(18,29,5,3,skin);}
      this.spriteCache.set(key,s);return s;
    }
    drawPlayer(p,s,game){
      const c=this.ctx,view=game.authentic&&game.spriteView?game.spriteView(p,this.yaw):null;
      const nativeSprite=view?.canvas||(view?.width?view:null)||p.nativeSprite;
      const height=Math.max(3,Math.min(430,s.s*1.9)),width=height*(nativeSprite?nativeSprite.width/nativeSprite.height:24/36);const team=p.team===0?game.humanTeam:game.cpuTeam;
      c.fillStyle='rgba(5,30,24,.45)';c.beginPath();c.ellipse(s.x,s.y,Math.max(1,width*.48),Math.max(1,height*.055),0,0,Math.PI*2);c.fill();
      const back=p.team===game.possession?this.cos>0:this.cos<0;
      const frame=game.phase==='live'?(Math.floor(this.time*7+(p.id||0))%2):0;
      if(game.authentic){if(nativeSprite){
        if(view?.flipX){c.save();c.translate(Math.round(s.x),0);c.scale(-1,1);c.drawImage(nativeSprite,Math.round(-width/2),Math.round(s.y-height),Math.round(width),Math.round(height));c.restore();}
        else c.drawImage(nativeSprite,Math.round(s.x-width/2),Math.round(s.y-height),Math.round(width),Math.round(height));
      }else{c.strokeStyle='#f2cc71';c.strokeRect(s.x-2,s.y-6,4,5);}}else c.drawImage(this.sprite(team,p.number,back,frame,p.stunned>.2),Math.round(s.x-width/2),Math.round(s.y-height),Math.round(width),Math.round(height));
      if(p.hasBall){c.fillStyle='#f8c14e';c.fillRect(s.x-3,s.y-height-6,6,3);}
    }
    drawTargets(game){
      if(game.possession!==0||game.controlled?.role!=='QB'||(game.authentic&&game.play.type!=='pass'))return;
      game.receivers.forEach((p,i)=>{const s=this.project(p.x,2.8,p.z);if(!s)return;const selected=i===game.selectedReceiver;let x=Math.max(9,Math.min(this.width-9,s.x)),y=Math.max(15,Math.min(this.height-40,s.y));const c=this.ctx;
        c.fillStyle=selected?'#ffd061':'#162b42';c.fillRect(x-6,y-6,13,13);pixelText(c,i+1,x,y-3,1,selected?'#19253a':'#f3f0d0','center');if(selected){c.beginPath();c.moveTo(x-3,y+8);c.lineTo(x+4,y+8);c.lineTo(x,y+12);c.fill();}
      });
    }
    drawHands(game,moving,bob){
      const p=game.controlled;if(!p||game.authentic)return;const c=this.ctx,h=this.height;const offset=moving?Math.sin(this.time*10)*2:Math.sin(this.time*2)*1;
      const team=game.humanTeam;const jersey=team?.primary||'#205bc3',skin='#dba17b',dark='#172235',glove='#ebedd4';
      const r=(x,y,w,height,col)=>{c.fillStyle=col;c.fillRect(Math.floor(x),Math.floor(y+offset),w,height);};
      if(p.hasBall&&!game.ball?.flight){
        r(96,h-24,40,25,dark);r(100,h-21,32,23,jersey);r(115,h-30,27,15,glove);r(124,h-38,25,22,skin);r(138,h-51,23,35,skin);
        r(250,h-22,43,24,dark);r(254,h-19,36,24,jersey);r(234,h-32,27,18,glove);r(225,h-40,25,23,skin);
        r(149,h-57,60,7,dark);r(137,h-50,84,28,dark);r(149,h-63,60,12,'#744127');r(137,h-51,84,27,'#935535');r(143,h-49,72,21,'#ac6941');r(151,h-54,60,8,'#bf8654');r(160,h-22,42,6,'#633a28');
        r(163,h-54,34,2,'#f3e4c5');for(let i=0;i<6;i++)r(166+i*5,h-56,2,7,'#f3e4c5');r(148,h-53,3,28,'#f3e4c5');r(208,h-51,3,24,'#f3e4c5');
        r(138,h-33,13,8,skin);r(213,h-35,15,8,skin);
      }else{
        for(const side of [0,1]){const x=side?292:57;r(x,h-23,34,25,dark);r(x+3,h-21,28,25,jersey);r(x+(side?-7:17),h-34,23,19,glove);r(x+(side?-8:19),h-48,20,17,skin);r(x+(side?-8:19),h-53,4,8,skin);r(x+(side?-2:25),h-57,4,12,skin);r(x+(side?4:31),h-54,4,10,skin);r(x+(side?10:37),h-49,4,9,skin);}
      }
      if(game.phase==='presnap'){pixelText(c,game.possession===0?'SPACE TO SNAP':'READ THE OFFENSE',this.width/2,115,1,'#fff1c9','center');}
    }
    drawMap(game){
      const c=this.mapCtx;if(!c)return;const w=this.map.width,h=this.map.height;c.fillStyle='#163b30';c.fillRect(0,0,w,h);
      const sx=x=>(x+28)/56*w,sy=z=>h-8-z/100*(h-16);
      c.fillStyle='#22384c';c.fillRect(0,0,w,8);c.fillRect(0,h-8,w,8);c.strokeStyle='#397353';c.lineWidth=1;
      for(let z=0;z<=100;z+=10){c.beginPath();c.moveTo(0,sy(z));c.lineTo(w,sy(z));c.stroke();}
      c.strokeStyle='#44dae0';c.beginPath();c.moveTo(0,sy(game.los));c.lineTo(w,sy(game.los));c.stroke();c.strokeStyle='#ffd061';c.beginPath();c.moveTo(0,sy(Math.min(100,game.los+game.toGo)));c.lineTo(w,sy(Math.min(100,game.los+game.toGo)));c.stroke();
      for(const p of game.players){c.fillStyle=p.team===0?'#83bbff':'#ff6e7e';c.fillRect(Math.round(sx(p.x))-2,Math.round(sy(p.z))-2,4,4);if(p.id===game.controlled?.id){c.strokeStyle='#ffe28b';c.strokeRect(Math.round(sx(p.x))-4,Math.round(sy(p.z))-4,8,8);}if(p.hasBall){c.fillStyle='#fff0b9';c.fillRect(Math.round(sx(p.x))-1,Math.round(sy(p.z))-1,2,2);}}
      if(game.ball?.flight){c.fillStyle='#fff';c.fillRect(sx(game.ball.x)-1,sy(game.ball.z)-1,3,3);}
    }
  }
  globalThis.FieldRenderer=FieldRenderer;globalThis.pixelText=pixelText;
})();


;/* src/nes-mode.js */
/* ROM-backed mode. The NES CPU, PPU, and APU supply the original game.
   This file only routes input/output and projects documented live RAM. */
(function () {
  'use strict';
  const $=id=>document.getElementById(id),canvas=$('nes-main'),ctx=canvas.getContext('2d',{alpha:false}),reference=$('nes-reference'),refctx=reference.getContext('2d',{alpha:false});
  const renderer=new FieldRenderer(canvas,null),mapper=new TecmoNesState(globalThis.TECMO_ROSTERS),sprites=new TecmoNesSprites();
  const nativeCanvas=document.createElement('canvas');nativeCanvas.width=256;nativeCanvas.height=240;const nativeCtx=nativeCanvas.getContext('2d',{alpha:false});const nativeImage=nativeCtx.createImageData(256,240),nativeWords=new Uint32Array(nativeImage.data.buffer);
  ctx.imageSmoothingEnabled=false;refctx.imageSmoothingEnabled=false;
  let nes=null,romData=null,romName='',romFingerprint='',running=false,paused=false,perspective=true,referenceVisible=true,fieldGuides=true,sound=true,lookYaw=0,viewYaw=0,renderedLookYaw=0,cameraView='player',helpOpen=false,helpResume=false,state=null,previousState=null,accumulator=0,lastTime=0,lastFrameCount=0,frameCount=0,fpsAt=0,dirtyBattery=false;
  const keys=new Set(),buttonStates=new Set();let padButtons=[],padIdentity=null,padNeedsNeutral=false;
  class NativeSound {
    constructor(){this.ctx=null;this.node=null;this.gain=null;this.worklet=false;this.left=new Float32Array(16384);this.right=new Float32Array(16384);this.read=0;this.write=0;this.count=0;this.batchL=[];this.batchR=[];this.sampleRate=48000;}
    async init(){try{await this.open();const status=this.ctx?.state||'unsupported';$('native-sound').setAttribute('data-audio-state',status);$('native-sound').title=status==='running'?'Original NES audio ready':'Click to enable original NES audio';return status==='running';}catch(e){$('native-sound').setAttribute('data-audio-state','unavailable');$('native-sound').title='This browser could not start audio. Click to retry.';return false;}}
    async open(){if(this.ctx){await this.ctx.resume();return;}const C=window.AudioContext||window.webkitAudioContext;if(!C)return;this.ctx=new C({sampleRate:48000});this.sampleRate=this.ctx.sampleRate;this.gain=this.ctx.createGain();this.gain.gain.value=sound ? 0.55 : 0;this.gain.connect(this.ctx.destination);
      if(this.ctx.audioWorklet&&window.AudioWorkletNode){
        const code=`class TecmoPCM extends AudioWorkletProcessor {constructor(){super();this.l=new Float32Array(16384);this.r=new Float32Array(16384);this.i=0;this.w=0;this.n=0;this.port.onmessage=e=>{if(e.data.clear){this.n=0;this.i=this.w;return;}let {l,r}=e.data;for(let k=0;k<l.length;k++){if(this.n===16384){this.i=(this.i+1)%16384;this.n--;}this.l[this.w]=l[k];this.r[this.w]=r[k];this.w=(this.w+1)%16384;this.n++;}};}process(a,b){let o=b[0];if(o?.[0])for(let k=0;k<o[0].length;k++){let l=0,r=0;if(this.n){l=this.l[this.i];r=this.r[this.i];this.i=(this.i+1)%16384;this.n--;}o[0][k]=l;if(o[1])o[1][k]=r;}return true;}}registerProcessor('tecmo-pcm',TecmoPCM);`;
        const url=URL.createObjectURL(new Blob([code],{type:'application/javascript'}));try{await this.ctx.audioWorklet.addModule(url);this.node=new AudioWorkletNode(this.ctx,'tecmo-pcm',{outputChannelCount:[2]});this.worklet=true;}catch(_){this.node=null;}finally{URL.revokeObjectURL(url);}
      }
      if(!this.node){this.node=this.ctx.createScriptProcessor(2048,0,2);this.node.onaudioprocess=e=>{const l=e.outputBuffer.getChannelData(0),r=e.outputBuffer.getChannelData(1);for(let i=0;i<l.length;i++){if(this.count){l[i]=this.left[this.read];r[i]=this.right[this.read];this.read=(this.read+1)%16384;this.count--;}else l[i]=r[i]=0;}};}
      this.node.connect(this.gain);await this.ctx.resume();
    }
    push(l,r){if(!this.node||paused||this.ctx?.state!=='running')return;if(this.worklet){this.batchL.push(l);this.batchR.push(r);return;}if(this.count===16384){this.read=(this.read+1)%16384;this.count--;}this.left[this.write]=l;this.right[this.write]=r;this.write=(this.write+1)%16384;this.count++;}
    flush(){if(this.worklet&&this.batchL.length){this.node.port.postMessage({l:Float32Array.from(this.batchL),r:Float32Array.from(this.batchR)});this.batchL.length=this.batchR.length=0;}}
    clear(){this.count=0;this.read=this.write;this.batchL.length=this.batchR.length=0;if(this.worklet)this.node.port.postMessage({clear:true});}
    mute(value){sound=!value;if(this.gain)this.gain.gain.setTargetAtTime(sound?.55:0,this.ctx.currentTime,.02);}
  }
  const pcm=new NativeSound();
  function text(id,value){const el=$(id);value=String(value);if(el.textContent!==value)el.textContent=value;}
  function error(message){text('rom-error',message);$('rom-error').classList.remove('hidden');}
  function crc32(bytes){let crc=0xffffffff;for(const b of bytes){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return ((crc^0xffffffff)>>>0).toString(16).padStart(8,'0');}
  function validate(bytes){if(bytes.length<16||bytes[0]!==0x4e||bytes[1]!==0x45||bytes[2]!==0x53||bytes[3]!==0x1a)throw new Error('Choose the NES .nes game file, with its iNES header. A ZIP, SNES ROM, or sprite sheet cannot run the NES engine.');const mapperId=(bytes[6]>>4)|(bytes[7]&0xf0);if(mapperId!==4||bytes[4]!==16||bytes[5]!==16)throw new Error('This bridge targets the original USA NES Tecmo Super Bowl layout (MMC3, 256 KiB PRG, 128 KiB CHR). This file has a different layout.');const need=16+(bytes[6]&4?512:0)+bytes[4]*16384+bytes[5]*8192;if(bytes.length<need)throw new Error('The game file is incomplete. Choose the full .nes file.');if(bytes[6]&4)throw new Error('Trainer ROMs are not yet supported by the Tecmo RAM bridge. Use an unmodified USA game file.');return true;}
  async function loadROM(file){
    try{await pcm.init();const bytes=new Uint8Array(await file.arrayBuffer());validate(bytes);romData=bytes;romName=file.name;romFingerprint=crc32(bytes);const stockROM=crc32(bytes.subarray(16,393232))==='179a0d57';nes=new jsnes.NES({sampleRate:pcm.sampleRate,emulateSound:true,onFrame:buffer=>{for(let i=0;i<buffer.length;i++)nativeWords[i]=0xff000000|buffer[i];nativeCtx.putImageData(nativeImage,0,0);},onAudioSample:(l,r)=>pcm.push(l,r),onBatteryRamWrite:()=>{dirtyBattery=true;}});nes.loadROM(bytes);
      try{const stored=JSON.parse(localStorage.getItem('tecmo-nes-battery-'+romFingerprint)||'null');if(Array.isArray(stored)&&stored.length===8192)for(let i=0;i<8192;i++)nes.cpu.mem[0x6000+i]=stored[i]&255;}catch(_){}
      state=previousState=null;running=true;paused=false;helpOpen=helpResume=false;accumulator=0;frameCount=0;fpsAt=0;cameraView='player';perspective=true;updateCameraControls();resetCamera();keys.clear();buttonStates.clear();pendingPulse.clear();padButtons=[];padNeedsNeutral=padIdentity!==null;sprites.clear?.();pcm.clear();$('rom-overlay').classList.add('hidden');$('rom-error').classList.add('hidden');$('nes-paused').classList.add('hidden');$('nes-help').classList.add('hidden');$('native-help').setAttribute('aria-expanded','false');$('nes-screen-controls').classList.remove('hidden');for(const id of ['view-button','camera-mode','field-guides','reference-toggle','native-pause','save-state','load-state','reset-rom'])$(id).disabled=false;updateReferenceVisibility();text('native-pause','PAUSE · ESC');text('engine-status',(stockROM?'STOCK TECMO ROM':'UNVERIFIED ROM LAYOUT')+' · NES ENGINE ACTIVE');text('reference-label','UNMODIFIED NES VIDEO OUTPUT');text('bridge-note',(stockROM?'Original NES game active. ':'This ROM differs from the stock USA game; camera mapping may differ. ')+'WASD moves with the camera. Space acts; Tab cycles. C changes camera, P compares the NES view, G toggles field guides. HELP shows all controls.');canvas.focus({preventScroll:true});
    }catch(e){error(e.message||String(e));}
  }
  function release(){keys.clear();pendingPulse.clear();if(nes){for(const b of buttonStates)nes.buttonUp(1,b);buttonStates.clear();}}
  function pause(value=!paused){if(!running)return;paused=value;if(paused)padNeedsNeutral=true;release();pcm.clear();$('nes-paused').classList.toggle('hidden',!paused||helpOpen);text('native-pause',paused?'RESUME · ESC':'PAUSE · ESC');if(paused)document.exitPointerLock?.();else{pcm.init();canvas.focus({preventScroll:true});}}
  function toggleHelp(){if(helpOpen){helpOpen=false;$('nes-help').classList.add('hidden');$('native-help').setAttribute('aria-expanded','false');if(helpResume)pause(false);else{if(running)pause(paused);canvas.focus({preventScroll:true});}helpResume=false;}else{helpResume=running&&!paused;helpOpen=true;release();if(running)pause(true);$('nes-help').classList.remove('hidden');$('native-help').setAttribute('aria-expanded','true');$('nes-help-close').focus({preventScroll:true});}}
  function pulseButton(button,fromPad=false){if(!nes||paused)return;nes.buttonDown(1,button);buttonStates.add(button);pendingPulse.set(button,{frames:2,fromPad});}
  const pendingPulse=new Map();
  function discardPadPulses(){for(const [button,pulse] of pendingPulse)if(pulse.fromPad)pendingPulse.delete(button);}
  function nativeAction(){if(!nes||paused)return;const C=jsnes.Controller;let button=C.BUTTON_A;if(state?.isOnField&&state.phase==='live'){button=state.controlled?.hasBall&&state.ballPossession!==state.possession?C.BUTTON_A:state.controlled?.team===state.possession?(state.controlled?.role==='QB'?C.BUTTON_B:C.BUTTON_A):C.BUTTON_B;}pulseButton(button);}
  function setButton(button,on){if(on&&!buttonStates.has(button)){nes.buttonDown(1,button);buttonStates.add(button);}else if(!on&&buttonStates.has(button)){nes.buttonUp(1,button);buttonStates.delete(button);}}
  function gamepad(){
    let pads=[];try{pads=navigator.getGamepads?.()||[];}catch(_){/* Browser policy can disable the API; keyboard play continues. */}
    const pad=Array.from(pads).find(candidate=>candidate&&candidate.connected!==false);
    if(!pad){if(padIdentity!==null){padNeedsNeutral=true;discardPadPulses();}padIdentity=null;padButtons=[];return null;}
    const identity=(pad.index??0)+':'+(pad.id||'');
    if(padIdentity!==null&&padIdentity!==identity){padNeedsNeutral=true;padButtons=[];discardPadPulses();}
    padIdentity=identity;
    // Pause, focus loss, or replacement must not replay buttons or an off-center
    // stick held before the interruption. Release once to rearm the controller.
    if(padNeedsNeutral){padButtons=pad.buttons.map(button=>!!button.pressed);if(padButtons.some(Boolean)||Array.from(pad.axes||[]).some(axis=>Math.abs(axis)>.18))return null;padNeedsNeutral=false;}
    const edge=i=>pad.buttons[i]?.pressed&&!padButtons[i];
    if(edge(11))$('camera-mode').click();
    if(edge(4)||edge(5))pulseButton(jsnes.Controller.BUTTON_A,true);
    padButtons=pad.buttons.map(button=>!!button.pressed);return pad;
  }
  function routeInput(dt,pad){
    if(!nes||paused)return;const C=jsnes.Controller;let x=(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0),z=(keys.has('KeyW')||keys.has('ArrowUp')?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')?1:0);
    if(pad){x+=(Math.abs(pad.axes[0]||0)>.18?pad.axes[0]:0);z-=(Math.abs(pad.axes[1]||0)>.18?pad.axes[1]:0);x+=(pad.buttons[15]?.pressed?1:0)-(pad.buttons[14]?.pressed?1:0);z+=(pad.buttons[12]?.pressed?1:0)-(pad.buttons[13]?.pressed?1:0);lookYaw+=(Math.abs(pad.axes[2]||0)>.18?pad.axes[2]:0)*dt*1.9;}
    lookYaw+=((keys.has('KeyE')?1:0)-(keys.has('KeyQ')?1:0))*dt*1.8;
    let nativeX=x,nativeY=-z;
    if(perspective&&state?.isOnField){const heading=viewYaw+(lookYaw-renderedLookYaw),wx=x*Math.cos(heading)+z*Math.sin(heading),wz=z*Math.cos(heading)-x*Math.sin(heading);nativeX=wz*state.direction;nativeY=wx*state.direction;}
    const active=new Set();if(nativeX>.25)active.add(C.BUTTON_RIGHT);if(nativeX<-.25)active.add(C.BUTTON_LEFT);if(nativeY>.25)active.add(C.BUTTON_DOWN);if(nativeY<-.25)active.add(C.BUTTON_UP);if(keys.has('KeyX')||pad?.buttons[0]?.pressed)active.add(C.BUTTON_A);if(keys.has('KeyZ')||pad?.buttons[1]?.pressed)active.add(C.BUTTON_B);if(keys.has('Enter')||pad?.buttons[9]?.pressed)active.add(C.BUTTON_START);if(keys.has('ShiftLeft')||keys.has('ShiftRight')||pad?.buttons[8]?.pressed)active.add(C.BUTTON_SELECT);
    for(const [b,pulse] of pendingPulse){active.add(b);if(pulse.frames<=1)pendingPulse.delete(b);else pulse.frames--;}
    for(let b=0;b<8;b++)setButton(b,active.has(b));
  }
  function persistBattery(){if(!nes||!dirtyBattery)return;try{localStorage.setItem('tecmo-nes-battery-'+romFingerprint,JSON.stringify(Array.from(nes.cpu.mem.slice(0x6000,0x8000))));dirtyBattery=false;}catch(_){text('native-readout','BATTERY SAVE STORAGE FULL · USE SAVE STATE');}}
  function renderNative(){ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);const h=canvas.height,w=h*256/240;ctx.drawImage(nativeCanvas,(canvas.width-w)/2,0,w,h);}
  function updateReadout(){if(!state)return;const q=state.quarter??1,clock=state.clock??0;text('native-readout',`${state.humanTeam?.abbr||'P1'} ${state.scores?.[0]??0} · ${state.cpuTeam?.abbr||'P2'} ${state.scores?.[1]??0} · Q${q} · ${Math.floor(clock/60)}:${String(Math.floor(clock%60)).padStart(2,'0')}`);const watched=renderer.cameraPlayer||state.carrier;const cameraLabel=renderer.cameraShot?.label||'PLAYER CAM';text('native-player-name',cameraLabel+' · '+(watched?(watched.name||watched.role):'BALL IN FLIGHT'));const player=state.controlled;const controlLabel=player?.name||player?.role||'P1';const action=state.play?.kind==='kickoff'&&!state.carrier?'KICKOFF · X A / Z B':player?.team!==state.possession?'DEFENSE · Z TACKLE':state.phase==='presnap'?'SPACE SNAP':player?.role==='QB'?'TAB TARGET · SPACE THROW':'X BREAK TACKLE';text('native-play-read',controlLabel+' · '+action);}
  function loop(now){
    const dt=Math.min(.1,(now-lastTime)/1000||1/60);lastTime=now;
    if(running&&nes&&!paused){const pad=gamepad();accumulator+=dt;let steps=0;try{while(accumulator>=1/60.0988&&steps<6){routeInput(1/60.0988,pad);nes.frame();state=mapper.read(nes);accumulator-=1/60.0988;steps++;frameCount++;}pcm.flush();if(state?.isOnField&&perspective){if(!previousState?.isOnField){resetCamera();viewYaw=(state.ballPossession??state.possession)===state.possession?0:Math.PI;}sprites.capture(nes,state);state.stadiumSprite=sprites.captureStadium(nes,state);state.nativeHUD=nativeCanvas;state.nativeHUDRect={x:0,y:0,width:256,height:32};state.spriteView=typeof sprites.viewSprite==='function'?(player,yaw)=>sprites.viewSprite(player,yaw):null;state.fieldAtlas=sprites.captureField?.(nes,state)||null;const colors=Array.from(nes.ppu.imgPalette||[]).map(c=>[c&255,(c>>>8)&255,(c>>>16)&255]);const greens=colors.filter(c=>c[1]>c[0]*1.2&&c[1]>c[2]*1.15&&c[1]>35).sort((a,b)=>b[1]-a[1]);const whites=colors.filter(c=>Math.min(...c)>160).sort((a,b)=>b.reduce((x,y)=>x+y,0)-a.reduce((x,y)=>x+y,0));state.fieldPalette={turf:greens[0]||[0,136,0],marking:whites[0]||[248,248,248]};state.authentic=true;renderer.render(state,dt,{lookYaw,cameraView,fieldGuides,moving:keys.has('KeyW')||keys.has('KeyA')||keys.has('KeyS')||keys.has('KeyD')});viewYaw=Number.isFinite(renderer.yaw)?renderer.yaw:((state.ballPossession??state.possession)===state.possession?0:Math.PI)+lookYaw;renderedLookYaw=lookYaw;$('native-camera-hud').classList.remove('hidden');text('reference-label',`ORIGINAL NES VIEW · ${sprites.availableCount??0}/22 PLAYER SPRITES`);}else{renderNative();$('native-camera-hud').classList.add('hidden');}if(referenceVisible)refctx.drawImage(nativeCanvas,0,0);updateReadout();previousState=state;if(now-fpsAt>1000){text('native-fps',Math.round((frameCount-lastFrameCount)*1000/(now-fpsAt||1000))+' FPS');fpsAt=now;lastFrameCount=frameCount;persistBattery();}}catch(e){running=false;pcm.clear();release();error('Emulation stopped: '+(e.message||e)+'. Switch to a stock USA ROM or reload the file.');}}
    else if(!romData){ctx.fillStyle='#142339';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#213854';for(let i=0;i<240;i+=12)ctx.fillRect(0,i,384,1);}
    requestAnimationFrame(loop);
  }
  $('rom-file').addEventListener('change',e=>{if(e.target.files[0])loadROM(e.target.files[0]);e.target.value='';});$('new-rom').onclick=()=>{pcm.init();$('rom-file').click();};document.querySelector('.rom-file-button').addEventListener('click',()=>pcm.init());document.querySelector('.rom-file-button').addEventListener('keydown',e=>{if(e.code==='Enter'||e.code==='Space'){e.preventDefault();e.stopPropagation();pcm.init();$('rom-file').click();}});
  const viewport=$('nes-viewport');viewport.addEventListener('dragover',e=>{e.preventDefault();viewport.classList.add('drag-over');});viewport.addEventListener('dragleave',()=>viewport.classList.remove('drag-over'));viewport.addEventListener('drop',e=>{e.preventDefault();viewport.classList.remove('drag-over');if(e.dataTransfer.files[0])loadROM(e.dataTransfer.files[0]);});
  function updateReferenceVisibility(){
    $('reference-pip').classList.toggle('hidden',!running||!referenceVisible);
    $('reference-toggle').setAttribute('aria-pressed',String(referenceVisible));
    text('reference-toggle',referenceVisible?'NES REF: ON':'NES REF: OFF');
    if(running&&referenceVisible)refctx.drawImage(nativeCanvas,0,0);
  }
  $('reference-toggle').onclick=()=>{if(!running)return;referenceVisible=!referenceVisible;updateReferenceVisibility();release();canvas.focus({preventScroll:true});};
  function resetCamera(){lookYaw=0;viewYaw=0;renderedLookYaw=0;renderer.resetCamera?.();}
  function updateCameraControls(){text('view-button',perspective?'VIEW: '+(cameraView==='helmet'?'HELMET':'PLAYER')+' · P':'VIEW: ORIGINAL NES · P');text('camera-mode','CAMERA: '+cameraView.toUpperCase()+' · C');$('camera-mode').setAttribute('aria-pressed',String(cameraView==='helmet'));}
  function updateGuideControls(){text('field-guides','GUIDES: '+(fieldGuides?'ON':'OFF')+' · G');$('field-guides').setAttribute('aria-pressed',String(fieldGuides));}
  $('camera-mode').onclick=()=>{if(!running)return;cameraView=cameraView==='player'?'helmet':'player';updateCameraControls();release();canvas.focus({preventScroll:true});};
  $('field-guides').onclick=()=>{if(!running)return;fieldGuides=!fieldGuides;updateGuideControls();release();canvas.focus({preventScroll:true});};
  $('view-button').onclick=()=>{perspective=!perspective;updateCameraControls();release();canvas.focus({preventScroll:true});};$('native-pause').onclick=()=>pause();$('nes-resume').onclick=()=>pause(false);$('native-help').onclick=toggleHelp;$('nes-help-close').onclick=toggleHelp;$('native-sound').onclick=()=>{pcm.init();pcm.mute(sound);text('native-sound','SOUND: '+(sound?'ON':'OFF')+' · M');$('native-sound').setAttribute('aria-pressed',String(sound));};$('native-fullscreen').onclick=()=>{if(document.fullscreenElement)document.exitFullscreen?.();else $('cabinet').requestFullscreen?.();};
  $('native-mouse').onclick=()=>{if(running&&!paused)canvas.requestPointerLock?.();};canvas.addEventListener('click',()=>{pcm.init();canvas.focus();if(running&&!paused&&state?.isOnField&&perspective)canvas.requestPointerLock?.();});document.addEventListener('pointerlockchange',()=>text('native-mouse','MOUSE: '+(document.pointerLockElement===canvas?'ON':'OFF')));document.addEventListener('mousemove',e=>{if(document.pointerLockElement===canvas&&!paused)lookYaw+=e.movementX*.0027;});
  document.addEventListener('keydown',e=>{if(helpOpen){if(['Escape','KeyH'].includes(e.code)){e.preventDefault();if(!e.repeat)toggleHelp();}else if(e.code==='Tab'){e.preventDefault();$('nes-help-close').focus({preventScroll:true});}return;}if(['SELECT','INPUT'].includes(e.target.tagName)||(e.target.tagName==='BUTTON'&&['Enter','Space'].includes(e.code)))return;if(['Space','Tab','Enter','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Escape'].includes(e.code))e.preventDefault();if(e.repeat)return;keys.add(e.code);if(e.code==='Escape')pause();else if(e.code==='KeyP')$('view-button').click();else if(e.code==='KeyC')$('camera-mode').click();else if(e.code==='KeyG')$('field-guides').click();else if(e.code==='KeyH')toggleHelp();else if(e.code==='Space')nativeAction();else if(e.code==='Tab'&&nes&&!paused)pulseButton(jsnes.Controller.BUTTON_A);else if(e.code==='KeyM')$('native-sound').click();});document.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>{release();if(running)pause(true);});document.addEventListener('visibilitychange',()=>{if(document.hidden&&running)pause(true);});window.addEventListener('pagehide',persistBattery);
  $('reset-rom').onclick=()=>{if(!nes)return;release();nes.reloadROM();sprites.clear?.();pcm.clear();state=previousState=null;resetCamera();accumulator=0;pause(false);};
  $('save-state').onclick=()=>{if(!nes)return;const data={format:'tecmo-fp-jsnes-2.1',romCRC32:romFingerprint,romName,state:nes.toJSON()};const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='Tecmo-'+romFingerprint+'-save.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};$('load-state').onclick=()=>$('state-file').click();$('state-file').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{const data=JSON.parse(await file.text());if(data.format!=='tecmo-fp-jsnes-2.1'||data.romCRC32!==romFingerprint)throw new Error('Choose a save created with this exact ROM.');release();nes.fromJSON(data.state);sprites.clear?.();pcm.clear();state=previousState=null;resetCamera();pause(false);$('rom-error').classList.add('hidden');}catch(err){error('Save could not be loaded: '+err.message);}e.target.value='';};
  function setupRosters(){const db=globalThis.TECMO_ROSTERS;if(!db)return;db.teams.forEach(t=>{const o=document.createElement('option');o.value=t.id;o.textContent=(t.city+' '+t.name).toUpperCase();$('roster-team').append(o);});function teamChange(){const t=db.teams.find(t=>String(t.id)===$('roster-team').value);$('roster-player').replaceChildren();(t.roster||db.players.filter(p=>p.team_id===t.id)).forEach(p=>{const o=document.createElement('option');o.value=p.id;o.textContent=`${p.position_detail} · ${p.name.toUpperCase()}`;$('roster-player').append(o);});const rb=(t.roster||db.players.filter(p=>p.team_id===t.id)).find(p=>p.position_detail==='RB1');if(rb)$('roster-player').value=rb.id;playerChange();}function playerChange(){const p=db.players.find(p=>String(p.id)===$('roster-player').value),t=db.teams.find(t=>t.id===p?.team_id);if(!p)return;text('roster-position',p.position_detail);text('roster-name',p.name.toUpperCase());text('roster-number',`#${p.jerseyNumber??p.jersey} · ${t.city.toUpperCase()}`);$('roster-stats').replaceChildren();const aliases={running_speed:'RUN SPEED',maximum_speed:'MAX SPEED',max_speed:'MAX SPEED',rushing_power:'RUSH POWER',hitting_power:'HIT POWER',pass_control:'PASS CONTROL',pass_speed:'PASS SPEED',passing_speed:'PASS SPEED',pass_accuracy:'PASS ACCURACY',passing_accuracy:'PASS ACCURACY',accuracy_of_passing:'PASS ACCURACY',avoid_pass_block:'AVOID BLOCK',ball_control:'BALL CONTROL',receiving:'RECEIVING',receptions:'RECEPTIONS',catching:'CATCHING',interception:'INTERCEPTION',interceptions:'INTERCEPTION',pass_interceptions:'INTERCEPTIONS',quickness:'QUICKNESS',kicking_ability:'KICK ABILITY',kicking_power:'KICK POWER'};for(const [key,label]of Object.entries(aliases)){const value=p[key]??p.attributes?.[key];if(typeof value!=='number')continue;const el=document.createElement('div'),l=document.createElement('label'),v=document.createElement('strong'),bar=document.createElement('i'),fill=document.createElement('span');l.textContent=label;v.textContent=value;fill.style.width=value+'%';bar.append(fill);el.append(l,v,bar);$('roster-stats').append(el);}}$('roster-team').onchange=teamChange;$('roster-player').onchange=playerChange;teamChange();}
  async function findLocalROMs(){
    if(document.documentElement?.dataset?.staticHost==='true')return;
    if(!window.location||!['127.0.0.1','localhost','[::1]'].includes(window.location.hostname)||typeof fetch!=='function')return;
    try{const response=await fetch('/api/local-roms',{cache:'no-store'});if(!response.ok)return;const data=await response.json();const files=(data.roms||[]).filter(f=>typeof f.name==='string'&&typeof f.url==='string'&&f.url.startsWith('/api/local-roms/'));if(!files.length)return;
      const select=$('local-rom-select');for(const file of files){const o=document.createElement('option');o.value=file.url;o.textContent=file.name;select.append(o);}select.hidden=files.length===1;text('local-rom-name',files.length===1?files[0].name:'Choose your game from the local rom folder');$('local-rom-choice').classList.remove('hidden');
      $('local-rom-load').onclick=async()=>{const button=$('local-rom-load');button.disabled=true;try{await pcm.init();const chosen=files.find(f=>f.url===select.value)||files[0];const response=await fetch(chosen.url,{cache:'no-store'});if(!response.ok)throw new Error('Local ROM could not be read. Use LOAD TECMO .NES to choose it.');const bytes=await response.arrayBuffer();await loadROM({name:chosen.name,arrayBuffer:async()=>bytes});}catch(e){error(e.message||String(e));}finally{button.disabled=false;}};
    }catch(_){}
  }
  updateCameraControls();updateGuideControls();setupRosters();findLocalROMs();requestAnimationFrame(loop);globalThis.TecmoNesBridge={loadROM,validate,get nes(){return nes;},get state(){return state;},get running(){return running;},get paused(){return paused;},pause};
})();

;
