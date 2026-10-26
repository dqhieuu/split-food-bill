// Bank directory snapshot: 2026-10-27. Kept local so suggestions work offline.
// Names/codes: https://api.vietqr.vn/vi/danh-sach-ma-ngan-hang
// Routing BINs: https://api.vietqr.io/v2/banks
// Liobank accounts are held at OCB: https://liobank.vn/faq/deposit
// Generic IBK has no BIN: select its Hanoi or Ho Chi Minh City branch.
export const banks = [
	{
		code: 'TCB',
		name: 'Ngân hàng TMCP Kỹ thương Việt Nam',
		shortName: 'Techcombank',
		bin: '970407',
		aliases: []
	},
	{
		code: 'COOPBANK',
		name: 'Ngân hàng Hợp tác xã Việt Nam',
		shortName: 'COOPBANK',
		bin: '970446',
		aliases: []
	},
	{
		code: 'ACB',
		name: 'Ngân hàng TMCP Á Châu',
		shortName: 'ACB',
		bin: '970416',
		aliases: []
	},
	{
		code: 'KBHN',
		name: 'Ngân hàng Kookmin - Chi nhánh Hà Nội',
		shortName: 'KookminHN',
		bin: '970462',
		aliases: []
	},
	{
		code: 'IBK',
		name: 'Ngân hàng Công nghiệp Hàn Quốc',
		shortName: 'IBK',
		bin: '',
		aliases: []
	},
	{
		code: 'VAB',
		name: 'Ngân hàng TMCP Việt Á',
		shortName: 'VietABank',
		bin: '970427',
		aliases: []
	},
	{
		code: 'MSB',
		name: 'Ngân hàng TMCP Hàng Hải',
		shortName: 'MSB',
		bin: '970426',
		aliases: []
	},
	{
		code: 'ABB',
		name: 'Ngân hàng TMCP An Bình',
		shortName: 'ABBANK',
		bin: '970425',
		aliases: []
	},
	{
		code: 'LIOBANK',
		name: 'Ngân hàng số LioBank',
		shortName: 'LioBank',
		bin: '970448',
		aliases: []
	},
	{
		code: 'VPB',
		name: 'Ngân hàng TMCP Việt Nam Thịnh Vượng',
		shortName: 'VPBank',
		bin: '970432',
		aliases: []
	},
	{
		code: 'CBB',
		name: 'Ngân hàng Thương mại TNHH MTV Xây dựng Việt Nam',
		shortName: 'CBBank',
		bin: '970444',
		aliases: [
			'Ngân hàng Thương mại trách nhiệm hữu hạn một thành viên Ngoại thương Công nghệ số (Vietcombank Neo Limited)'
		]
	},
	{
		code: 'KPB',
		name: 'Ngân hàng Đại chúng Kasikornbank - Chi nhánh TP. Hồ Chí Minh',
		shortName: 'KBank',
		bin: '668888',
		aliases: ['Ngân hàng Đại chúng TNHH Kasikornbank']
	},
	{
		code: 'WRB',
		name: 'Ngân hàng TNHH MTV Woori Việt Nam',
		shortName: 'Woori',
		bin: '970457',
		aliases: ['WVN']
	},
	{
		code: 'HSBC',
		name: 'Ngân hàng TNHH MTV HSBC (Việt Nam)',
		shortName: 'HSBC',
		bin: '458761',
		aliases: []
	},
	{
		code: 'BNPHCM',
		name: 'Ngân hàng BNP Paribas - Chi nhánh TP. Hồ Chí Minh',
		shortName: 'BNPHCM',
		bin: '963666',
		aliases: ['BNP HCM', 'Ngân hàng BNP Paribas – Chi nhánh Thành phố Hồ Chí Minh']
	},
	{
		code: 'GPB',
		name: 'Ngân hàng Thương mại TNHH MTV Dầu Khí Toàn Cầu',
		shortName: 'GPBank',
		bin: '970408',
		aliases: []
	},
	{
		code: 'PBVN',
		name: 'Ngân hàng TNHH MTV Public Việt Nam',
		shortName: 'PublicBank',
		bin: '970439',
		aliases: []
	},
	{
		code: 'CAKE',
		name: 'TMCP Việt Nam Thịnh Vượng - Ngân hàng số CAKE by VPBank',
		shortName: 'CAKE',
		bin: '546034',
		aliases: []
	},
	{
		code: 'VTB',
		name: 'Ngân hàng TMCP Công thương Việt Nam',
		shortName: 'Vietinbank',
		bin: '970415',
		aliases: ['ICB', 'VietinBank']
	},
	{
		code: 'BVB',
		name: 'Ngân hàng TMCP Bảo Việt',
		shortName: 'BaoVietBank',
		bin: '970438',
		aliases: []
	},
	{
		code: 'HONGLEONG',
		name: 'Ngân hàng TNHH MTV Hongleong Việt Nam',
		shortName: 'HongLeong',
		bin: '970442',
		aliases: ['HLBVN', 'Ngân hàng TNHH MTV Hong Leong Việt Nam']
	},
	{
		code: 'KEBHCM',
		name: 'Ngân hàng Keb Hana - Chi nhánh TP. Hồ Chí Minh',
		shortName: 'KEBHanaHCMBank',
		bin: '970466',
		aliases: []
	},
	{
		code: 'BNPHN',
		name: 'Ngân hàng BNP Paribas - Chi nhánh Hà Nội',
		shortName: 'BNPHN',
		bin: '963668',
		aliases: ['BNP HN', 'Ngân hàng BNP Paribas – Chi nhánh Hà Nội']
	},
	{
		code: 'VIB',
		name: 'Ngân hàng TMCP Quốc tế Việt Nam',
		shortName: 'VIB',
		bin: '970441',
		aliases: ['Ngân hàng TMCP Quốc tế Việt Nam']
	},
	{
		code: 'VRB',
		name: 'Ngân hàng Liên doanh Việt - Nga',
		shortName: 'VRB',
		bin: '970421',
		aliases: []
	},
	{
		code: 'OCB',
		name: 'Ngân hàng TMCP Phương Đông',
		shortName: 'OCB',
		bin: '970448',
		aliases: []
	},
	{
		code: 'BAB',
		name: 'Ngân hàng TMCP Bắc Á',
		shortName: 'BacABank',
		bin: '970409',
		aliases: []
	},
	{
		code: 'KBHCM',
		name: 'Ngân hàng Kookmin - Chi nhánh Thành phố Hồ Chí Minh',
		shortName: 'KookminHCM',
		bin: '970463',
		aliases: []
	},
	{
		code: 'DAB',
		name: 'Ngân hàng TMCP Đông Á',
		shortName: 'DongABank',
		bin: '970406',
		aliases: []
	},
	{
		code: 'CITIBANK',
		name: 'Ngân hàng Citibank - Chi nhánh Hà Nội',
		shortName: 'CitibankHN',
		bin: '533948',
		aliases: ['Citibank', 'Ngân hàng Citibank, N.A. - Chi nhánh Hà Nội']
	},
	{
		code: 'NCB',
		name: 'Ngân hàng TMCP Quốc Dân',
		shortName: 'NCB',
		bin: '970419',
		aliases: []
	},
	{
		code: 'VCAB',
		name: 'Ngân hàng TMCP Bản Việt',
		shortName: 'VietCapitalBank',
		bin: '970454',
		aliases: ['VCCB', 'Ngân hàng TMCP Bản Việt']
	},
	{
		code: 'DBS',
		name: 'DBS Bank Ltd - Chi nhánh Thành phố Hồ Chí Minh',
		shortName: 'DBSBank',
		bin: '796500',
		aliases: []
	},
	{
		code: 'NHB',
		name: 'Ngân hàng Nonghyup - Chi nhánh Hà Nội',
		shortName: 'Nonghyup',
		bin: '801011',
		aliases: ['NHB HN']
	},
	{
		code: 'VTLMONEY',
		name: 'Tổng Công ty Dịch vụ số Viettel - Chi nhánh tập đoàn công nghiệp viễn thông Quân Đội',
		shortName: 'ViettelMoney',
		bin: '971005',
		aliases: []
	},
	{
		code: 'LPB',
		name: 'Ngân hàng TMCP Lộc Phát Việt Nam',
		shortName: 'LPBank',
		bin: '970449',
		aliases: []
	},
	{
		code: 'STB',
		name: 'Ngân hàng TMCP Sài Gòn Thương Tín',
		shortName: 'Sacombank',
		bin: '970403',
		aliases: ['Ngân hàng TMCP Sài Gòn Tài Lộc']
	},
	{
		code: 'Ubank',
		name: 'TMCP Việt Nam Thịnh Vượng - Ngân hàng số Ubank by VPBank',
		shortName: 'Ubank',
		bin: '546035',
		aliases: []
	},
	{
		code: 'SHINHAN',
		name: 'Ngân hàng TNHH MTV Shinhan Việt Nam',
		shortName: 'ShinhanBank',
		bin: '970424',
		aliases: ['SHBVN']
	},
	{
		code: 'SBC',
		name: 'Ngân hàng TMCP Sài Gòn Công Thương',
		shortName: 'SaigonBank',
		bin: '970400',
		aliases: ['SGICB']
	},
	{
		code: 'AGR',
		name: 'Ngân hàng Nông nghiệp và Phát triển Nông thôn Việt Nam',
		shortName: 'Agribank',
		bin: '970405',
		aliases: ['VBA']
	},
	{
		code: 'HDB',
		name: 'Ngân hàng TMCP Phát triển Thành phố Hồ Chí Minh',
		shortName: 'HDBank',
		bin: '970437',
		aliases: []
	},
	{
		code: 'PGB',
		name: 'Ngân hàng TMCP Xăng dầu Petrolimex',
		shortName: 'PGBank',
		bin: '970430',
		aliases: ['Ngân hàng TMCP Thịnh vượng và Phát triển']
	},
	{
		code: 'MB',
		name: 'Ngân hàng TMCP Quân đội',
		shortName: 'MBBank',
		bin: '970422',
		aliases: []
	},
	{
		code: 'BIDC',
		name: 'Ngân hàng Đầu tư và Phát triển Campuchia – Chi nhánh Hà Nội',
		shortName: 'BIDC',
		bin: '555666',
		aliases: ['Ngân hàng Đầu Tư Và Phát Triển Campuchia - Chi nhánh Hà Nội']
	},
	{
		code: 'SAB',
		name: 'Ngân hàng TMCP Đông Nam Á',
		shortName: 'SeABank',
		bin: '970440',
		aliases: ['SEAB', 'Ngân hàng TMCP Đông Nam Á']
	},
	{
		code: 'VNPTMONEY',
		name: 'Trung tâm dịch vụ tài chính số VNPT- Chi nhánh Tổng công ty truyền thông (VNPT Fintech)',
		shortName: 'VNPTMoney',
		bin: '971011',
		aliases: []
	},
	{
		code: 'SHB',
		name: 'Ngân hàng TMCP Sài Gòn - Hà Nội',
		shortName: 'SHB',
		bin: '970443',
		aliases: []
	},
	{
		code: 'NAB',
		name: 'Ngân hàng TMCP Nam Á',
		shortName: 'NamABank',
		bin: '970428',
		aliases: []
	},
	{
		code: 'CUBHCM',
		name: 'Ngân hàng Cathay United Bank – Chi nhánh TP. Hồ Chí Minh',
		shortName: 'CathayUnitedBank',
		bin: '168999',
		aliases: ['Ngân hàng Cathay United Bank – Chi nhánh Hồ Chí Minh']
	},
	{
		code: 'PVCB',
		name: 'Ngân hàng TMCP Đại Chúng Việt Nam',
		shortName: 'PVcomBank',
		bin: '970412',
		aliases: ['Ngân hàng TMCP Đại Chúng Việt Nam']
	},
	{
		code: 'VBC',
		name: 'Ngân hàng TMCP Việt Nam Thương Tín',
		shortName: 'VietBank',
		bin: '970433',
		aliases: ['VIETBANK']
	},
	{
		code: 'UOB',
		name: 'Ngân hàng United Overseas - Chi nhánh TP. Hồ Chí Minh',
		shortName: 'UnitedOverseas',
		bin: '970458',
		aliases: []
	},
	{
		code: 'TPB',
		name: 'Ngân hàng TMCP Tiên Phong',
		shortName: 'TPBank',
		bin: '970423',
		aliases: []
	},
	{
		code: 'UMEE',
		name: 'Ngân hàng số Umee – Kiên Long Bank',
		shortName: 'Umee',
		bin: '970452',
		aliases: ['KLB', 'KienLongBank', 'Ngân hàng TMCP Kiên Long']
	},
	{
		code: 'CIMB',
		name: 'Ngân hàng TNHH MTV CIMB Việt Nam',
		shortName: 'CIMB',
		bin: '422589',
		aliases: []
	},
	{
		code: 'KLB',
		name: 'Ngân hàng TMCP Kiên Long',
		shortName: 'KienLongBank',
		bin: '970452',
		aliases: []
	},
	{
		code: 'VCB',
		name: 'Ngân hàng TMCP Ngoại Thương Việt Nam',
		shortName: 'Vietcombank',
		bin: '970436',
		aliases: ['Ngân hàng TMCP Ngoại Thương Việt Nam']
	},
	{
		code: 'TIMO',
		name: 'Ngân hàng số Timo by Ban Viet Bank (Timo by Ban Viet Bank)',
		shortName: 'Timo',
		bin: '963388',
		aliases: []
	},
	{
		code: 'IVB',
		name: 'Ngân hàng TNHH Indovina',
		shortName: 'IndovinaBank',
		bin: '970434',
		aliases: []
	},
	{
		code: 'SCB',
		name: 'Ngân hàng TMCP Sài Gòn',
		shortName: 'SCB',
		bin: '970429',
		aliases: []
	},
	{
		code: 'BIDV',
		name: 'Ngân hàng TMCP Đầu tư và Phát triển Việt Nam',
		shortName: 'BIDV',
		bin: '970418',
		aliases: []
	},
	{
		code: 'EIB',
		name: 'Ngân hàng TMCP Xuất Nhập khẩu Việt Nam',
		shortName: 'Eximbank',
		bin: '970431',
		aliases: []
	},
	{
		code: 'SCVN',
		name: 'Ngân hàng TNHH MTV Standard Chartered Bank Việt Nam',
		shortName: 'StandardChartered',
		bin: '970410',
		aliases: []
	},
	{
		code: 'MBV',
		name: 'Ngân hàng Thương mại TNHH MTV Đại Dương',
		shortName: 'Oceanbank',
		bin: '970414',
		aliases: ['Ngân hàng TNHH MTV Việt Nam Hiện Đại']
	},
	{
		code: 'KEBHN',
		name: 'Ngân hàng Keb Hana - Chi nhánh Hà Nội',
		shortName: 'KEBHanaHNBank',
		bin: '970467',
		aliases: []
	},
	{
		code: 'IBK - HN',
		name: 'Ngân hàng Công nghiệp Hàn Quốc - Chi nhánh Hà Nội',
		shortName: 'IBKHN',
		bin: '970455',
		aliases: []
	},
	{
		code: 'IBK - HCM',
		name: 'Ngân hàng Công nghiệp Hàn Quốc - Chi nhánh TP. Hồ Chí Minh',
		shortName: 'IBKHCM',
		bin: '970456',
		aliases: []
	}
];
