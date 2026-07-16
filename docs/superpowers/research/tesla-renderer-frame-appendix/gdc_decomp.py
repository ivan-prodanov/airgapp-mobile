#!/usr/bin/env python3
# Godot 3.2 (.gdc bytecode version 13) GDScript decompiler — token-buffer reconstructor.
# Format: "GDSC" + u32 version + u32 id_count + u32 const_count + u32 line_count + u32 token_count,
# then identifiers (u32 len + bytes XOR 0xb6), constants (binary Variant), lines (2*u32), tokens.
import sys, struct

def u32(b, o): return struct.unpack_from('<I', b, o)[0]

# --- token enum (Godot 3.2 gdscript_tokenizer.h order) ---
TOKENS = ["EMPTY","IDENTIFIER","CONSTANT","SELF","BUILT_IN_TYPE","BUILT_IN_FUNC",
"OP_IN","OP_EQUAL","OP_NOT_EQUAL","OP_LESS","OP_LESS_EQUAL","OP_GREATER","OP_GREATER_EQUAL",
"OP_AND","OP_OR","OP_NOT","OP_ADD","OP_SUB","OP_MUL","OP_DIV","OP_MOD","OP_SHIFT_LEFT","OP_SHIFT_RIGHT",
"OP_ASSIGN","OP_ASSIGN_ADD","OP_ASSIGN_SUB","OP_ASSIGN_MUL","OP_ASSIGN_DIV","OP_ASSIGN_MOD",
"OP_ASSIGN_SHIFT_LEFT","OP_ASSIGN_SHIFT_RIGHT","OP_ASSIGN_BIT_AND","OP_ASSIGN_BIT_OR","OP_ASSIGN_BIT_XOR",
"OP_BIT_AND","OP_BIT_OR","OP_BIT_XOR","OP_BIT_INVERT",
"CF_IF","CF_ELIF","CF_ELSE","CF_FOR","CF_WHILE","CF_BREAK","CF_CONTINUE","CF_PASS","CF_RETURN","CF_MATCH",
"PR_FUNCTION","PR_CLASS","PR_CLASS_NAME","PR_EXTENDS","PR_IS","PR_ONREADY","PR_TOOL","PR_STATIC","PR_EXPORT",
"PR_SETGET","PR_CONST","PR_VAR","PR_AS","PR_VOID","PR_ENUM","PR_PRELOAD","PR_ASSERT","PR_YIELD","PR_SIGNAL",
"PR_BREAKPOINT","PR_REMOTE","PR_SYNC","PR_MASTER","PR_SLAVE","PR_PUPPET","PR_REMOTESYNC","PR_MASTERSYNC","PR_PUPPETSYNC",
"BRACKET_OPEN","BRACKET_CLOSE","CURLY_BRACKET_OPEN","CURLY_BRACKET_CLOSE","PARENTHESIS_OPEN","PARENTHESIS_CLOSE",
"COMMA","SEMICOLON","PERIOD","QUESTION_MARK","COLON","DOLLAR","FORWARD_ARROW","NEWLINE",
"CONST_PI","CONST_TAU","WILDCARD","CONST_INF","CONST_NAN","ERROR","EOF","CURSOR"]
TXT = {"OP_IN":"in","OP_EQUAL":"==","OP_NOT_EQUAL":"!=","OP_LESS":"<","OP_LESS_EQUAL":"<=","OP_GREATER":">",
"OP_GREATER_EQUAL":">=","OP_AND":"and","OP_OR":"or","OP_NOT":"not","OP_ADD":"+","OP_SUB":"-","OP_MUL":"*",
"OP_DIV":"/","OP_MOD":"%","OP_SHIFT_LEFT":"<<","OP_SHIFT_RIGHT":">>","OP_ASSIGN":"=","OP_ASSIGN_ADD":"+=",
"OP_ASSIGN_SUB":"-=","OP_ASSIGN_MUL":"*=","OP_ASSIGN_DIV":"/=","OP_ASSIGN_MOD":"%=","OP_ASSIGN_SHIFT_LEFT":"<<=",
"OP_ASSIGN_SHIFT_RIGHT":">>=","OP_ASSIGN_BIT_AND":"&=","OP_ASSIGN_BIT_OR":"|=","OP_ASSIGN_BIT_XOR":"^=",
"OP_BIT_AND":"&","OP_BIT_OR":"|","OP_BIT_XOR":"^","OP_BIT_INVERT":"~","SELF":"self",
"CF_IF":"if","CF_ELIF":"elif","CF_ELSE":"else","CF_FOR":"for","CF_WHILE":"while","CF_BREAK":"break",
"CF_CONTINUE":"continue","CF_PASS":"pass","CF_RETURN":"return","CF_MATCH":"match","PR_FUNCTION":"func",
"PR_CLASS":"class","PR_CLASS_NAME":"class_name","PR_EXTENDS":"extends","PR_IS":"is","PR_ONREADY":"onready",
"PR_TOOL":"tool","PR_STATIC":"static","PR_EXPORT":"export","PR_SETGET":"setget","PR_CONST":"const","PR_VAR":"var",
"PR_AS":"as","PR_VOID":"void","PR_ENUM":"enum","PR_PRELOAD":"preload","PR_ASSERT":"assert","PR_YIELD":"yield",
"PR_SIGNAL":"signal","PR_BREAKPOINT":"breakpoint","PR_REMOTE":"remote","PR_SYNC":"sync","PR_MASTER":"master",
"PR_SLAVE":"slave","PR_PUPPET":"puppet","PR_REMOTESYNC":"remotesync","PR_MASTERSYNC":"mastersync","PR_PUPPETSYNC":"puppetsync",
"BRACKET_OPEN":"[","BRACKET_CLOSE":"]","CURLY_BRACKET_OPEN":"{","CURLY_BRACKET_CLOSE":"}",
"PARENTHESIS_OPEN":"(","PARENTHESIS_CLOSE":")","COMMA":",","SEMICOLON":";","PERIOD":".","QUESTION_MARK":"?",
"COLON":":","DOLLAR":"$","FORWARD_ARROW":"->","CONST_PI":"PI","CONST_TAU":"TAU","WILDCARD":"_",
"CONST_INF":"INF","CONST_NAN":"NAN","CURSOR":"","ERROR":"<ERR>","EOF":""}
VTYPE=["null","bool","int","float","String","Vector2","Rect2","Vector3","Transform2D","Plane","Quat","AABB",
"Basis","Transform","Color","NodePath","RID","Object","Dictionary","Array","PoolByteArray","PoolIntArray",
"PoolRealArray","PoolStringArray","PoolVector2Array","PoolVector3Array","PoolColorArray"]
# GDScriptFunctions (3.2) order for BUILT_IN_FUNC
FUNCS=["sin","cos","tan","sinh","cosh","tanh","asin","acos","atan","atan2","sqrt","fmod","fposmod","posmod",
"floor","ceil","round","abs","sign","pow","log","exp","is_nan","is_inf","is_equal_approx","is_zero_approx",
"ease","decimals","step_decimals","stepify","lerp","lerp_angle","inverse_lerp","range_lerp","smoothstep","move_toward",
"dectime","randomize","randi","randf","rand_range","seed","rand_seed","deg2rad","rad2deg","linear2db","db2linear",
"polar2cartesian","cartesian2polar","wrapi","wrapf","max","min","clamp","nearest_po2","weakref","funcref","convert",
"typeof","type_exists","char","ord","str","print","printt","prints","printerr","printraw","print_debug","push_error",
"push_warning","var2str","str2var","var2bytes","bytes2var","range","load","inst2dict","dict2inst","validate_json",
"parse_json","to_json","hash","Color8","ColorN","print_stack","get_stack","instance_from_id","len","is_instance_valid",
"deep_equal"]

def decode_variant(b, o):
    t = u32(b, o); o += 4
    flags = t >> 16; t &= 0xffff
    if t == 0: return None, o
    if t == 1: v = u32(b,o); o += 4; return (v != 0), o
    if t == 2:
        if flags & 1: v = struct.unpack_from('<q', b, o)[0]; o += 8
        else: v = struct.unpack_from('<i', b, o)[0]; o += 4
        return v, o
    if t == 3:
        if flags & 1: v = struct.unpack_from('<d', b, o)[0]; o += 8
        else: v = struct.unpack_from('<f', b, o)[0]; o += 4
        return v, o
    if t == 4 or t == 15:  # String / NodePath(simple)
        ln = u32(b, o); o += 4
        s = b[o:o+ln].decode('utf-8', 'replace'); o += ln
        o += (4 - (ln % 4)) % 4
        return (('@'+repr(s)) if t==15 else s), o
    if t == 5: v = struct.unpack_from('<2f', b, o); o += 8; return ("Vector2%s"%(v,)), o
    if t == 7: v = struct.unpack_from('<3f', b, o); o += 12; return ("Vector3%s"%(v,)), o
    if t == 14: v = struct.unpack_from('<4f', b, o); o += 16; return ("Color%s"%(v,)), o
    if t == 13: v = struct.unpack_from('<12f', b, o); o += 48; return ("Transform%s"%(v,)), o
    return ("<var t=%d>"%t), o

def main(path):
    b = open(path, 'rb').read()
    assert b[:4] == b'GDSC', "not a .gdc"
    ver = u32(b,4); idc = u32(b,8); cc = u32(b,12); lc = u32(b,16); tc = u32(b,20)
    o = 24
    ids = []
    for _ in range(idc):
        ln = u32(b, o); o += 4
        raw = bytes(x ^ 0xb6 for x in b[o:o+ln]); o += ln
        ids.append(raw.split(b'\x00')[0].decode('utf-8','replace'))
    consts = []
    for _ in range(cc):
        v, o = decode_variant(b, o); consts.append(v)
    for _ in range(lc):
        o += 8  # (token_index, linecol) — skipped for reconstruction
    toks = []
    for _ in range(tc):
        if b[o] & 0x80:
            val = u32(b, o) & ~0x80; o += 4
        else:
            val = b[o]; o += 1
        toks.append((val & 0xff, val >> 8))
    sys.stderr.write("ver=%d ids=%d consts=%d lines=%d tokens=%d\n" % (ver, idc, cc, lc, tc))
    # reconstruct
    out = []
    line = []
    def flush():
        if line:
            out.append(''.join(line)); line.clear()
    NOSPACE_BEFORE = {'(',')','[',']',',',':','.','\n'}
    NOSPACE_AFTER = {'(','[','.','$','\n','~'}
    prev = None
    for (ty, op) in toks:
        name = TOKENS[ty] if ty < len(TOKENS) else ("T%d"%ty)
        if name == "NEWLINE":
            flush(); out.append('\n' + '\t'*op); prev = '\n'; continue
        if name == "IDENTIFIER": s = ids[op] if op < len(ids) else ("id?%d"%op)
        elif name == "CONSTANT":
            c = consts[op] if op < len(consts) else ("c?%d"%op)
            s = repr(c) if isinstance(c, str) else str(c)
        elif name == "BUILT_IN_TYPE": s = VTYPE[op] if op < len(VTYPE) else ("type?%d"%op)
        elif name == "BUILT_IN_FUNC": s = FUNCS[op] if op < len(FUNCS) else ("func?%d"%op)
        elif name in ("EMPTY","EOF","CURSOR"): continue
        else: s = TXT.get(name, '<'+name+'>')
        # spacing
        if line and prev not in NOSPACE_AFTER and s and s[0] not in NOSPACE_BEFORE:
            line.append(' ')
        line.append(s); prev = s
    flush()
    text = ''.join(out)
    # tidy: strip leading blank lines
    print(text)

if __name__ == '__main__':
    main(sys.argv[1])
